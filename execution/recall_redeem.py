"""Fail-closed command-line enforcement for Recall-protected operations."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Sequence, TextIO

try:
    from execution.recall_live_adapter import (
        RecallBradburyAdapter,
        target_identity_from_env,
    )
    from execution.recall_redemption_gate import (
        RecallAuthorizationFailed,
        RecallNotActive,
        RecallRedemptionExecutionFailed,
        redeem_with_recall_gate,
    )
except ImportError:
    from recall_live_adapter import RecallBradburyAdapter, target_identity_from_env
    from recall_redemption_gate import (
        RecallAuthorizationFailed,
        RecallNotActive,
        RecallRedemptionExecutionFailed,
        redeem_with_recall_gate,
    )


EXIT_NOT_ACTIVE = 10
EXIT_AUTHORIZATION_FAILED = 11
EXIT_DOWNSTREAM_FAILED = 12


def _batch_id(value: str) -> int:
    try:
        parsed = int(value, 10)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("batch id must be an integer") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("batch id must be non-negative")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="recall-redeem",
        description="Authorize one downstream command using a fresh Recall read.",
    )
    parser.add_argument("--batch-id", required=True, type=_batch_id)
    parser.add_argument(
        "downstream",
        nargs=argparse.REMAINDER,
        help="downstream command and arguments; use -- before the command",
    )
    return parser


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _audit(
    stream: TextIO,
    contract_address: str,
    network_id: str,
    batch_id: int,
    authorization_result: str,
    downstream_result: str,
) -> None:
    record = {
        "authorization_result": authorization_result,
        "batch_id": batch_id,
        "contract_address": contract_address,
        "downstream_result": downstream_result,
        "network": network_id,
        "utc_timestamp": _utc_timestamp(),
    }
    print(json.dumps(record, sort_keys=True, separators=(",", ":")), file=stream)


def main(
    argv: Optional[Sequence[str]] = None,
    adapter: Optional[Any] = None,
    run_command: Callable[..., Any] = subprocess.run,
    audit_stream: Optional[TextIO] = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = list(args.downstream)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("a downstream command is required after --")
    stream = sys.stderr if audit_stream is None else audit_stream

    active_adapter = adapter
    if active_adapter is None:
        try:
            active_adapter = RecallBradburyAdapter.from_env()
        except Exception:
            contract_address, network_id = target_identity_from_env()
            _audit(
                stream,
                contract_address,
                network_id,
                args.batch_id,
                "error",
                "blocked",
            )
            return EXIT_AUTHORIZATION_FAILED

    try:
        redeem_with_recall_gate(
            active_adapter,
            args.batch_id,
            lambda: run_command(command, check=True),
        )
    except RecallNotActive:
        _audit(
            stream,
            active_adapter.contract_address,
            active_adapter.network_id,
            args.batch_id,
            "false",
            "blocked",
        )
        return EXIT_NOT_ACTIVE
    except RecallAuthorizationFailed:
        _audit(
            stream,
            active_adapter.contract_address,
            active_adapter.network_id,
            args.batch_id,
            "error",
            "blocked",
        )
        return EXIT_AUTHORIZATION_FAILED
    except RecallRedemptionExecutionFailed:
        _audit(
            stream,
            active_adapter.contract_address,
            active_adapter.network_id,
            args.batch_id,
            "true",
            "failed",
        )
        return EXIT_DOWNSTREAM_FAILED

    _audit(
        stream,
        active_adapter.contract_address,
        active_adapter.network_id,
        args.batch_id,
        "true",
        "succeeded",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
