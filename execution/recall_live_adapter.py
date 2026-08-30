"""Read-only Bradbury adapter for the deployed Recall contract.

The installed ``genlayer-py`` SDK is used for client construction, calldata
encoding, the ``gen_call`` request, and return decoding.  Bradbury currently
wraps the ``gen_call`` result in an envelope containing ``data`` while the
installed SDK expects the older bare encoded string.  The narrow compatibility
shim below unwraps only that verified response envelope before delegating back
to the SDK decoder.
"""

from __future__ import annotations

import os
import queue
import re
import threading
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional, cast
from urllib.parse import urlparse


DEFAULT_CONTRACT_ADDRESS = "0x876Eb31536FfB3eF448dbdeB905118E70761981C"
DEFAULT_RPC_URL = "https://rpc-bradbury.genlayer.com"
DEFAULT_NETWORK_ID = "Bradbury"
DEFAULT_READ_TIMEOUT_SECONDS = 20.0
AUDIT_INVALID_TARGET = "INVALID_OR_UNAVAILABLE"

CONTRACT_ADDRESS_ENV = "RECALL_CONTRACT_ADDRESS"
RPC_URL_ENV = "RECALL_RPC_URL"
NETWORK_ID_ENV = "RECALL_NETWORK_ID"
READ_TIMEOUT_ENV = "RECALL_READ_TIMEOUT_SECONDS"

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_NETWORK_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")


class RecallAdapterError(RuntimeError):
    """The Recall authorization read could not produce an exact boolean."""


class RecallReadTimeout(RecallAdapterError):
    """The authorization read exceeded its configured timeout."""


def parse_recall_active_result(value: Any) -> bool:
    """Accept only an actual Python bool returned by the contract decoder."""

    if type(value) is bool:
        return value
    raise RecallAdapterError("Recall read did not decode to an exact boolean")


def _validate_address(value: str) -> str:
    if not isinstance(value, str) or _ADDRESS_RE.fullmatch(value) is None:
        raise RecallAdapterError("Recall contract address is malformed")
    return value


def _validate_rpc_url(value: str) -> str:
    if not isinstance(value, str):
        raise RecallAdapterError("Recall RPC URL is malformed")
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise RecallAdapterError("Recall RPC URL is malformed")
    return value


def _validate_network_id(value: str) -> str:
    if not isinstance(value, str) or _NETWORK_ID_PATTERN.fullmatch(value) is None:
        raise RecallAdapterError("Recall network identifier is malformed")
    return value


def target_identity_from_env(
    environ: Optional[Mapping[str, str]] = None,
) -> tuple[str, str]:
    """Return safe target identity for audit records if adapter setup fails."""
    values = os.environ if environ is None else environ

    raw_contract_address = values.get(
        CONTRACT_ADDRESS_ENV,
        DEFAULT_CONTRACT_ADDRESS,
    )
    try:
        contract_address = _validate_address(raw_contract_address)
    except RecallAdapterError:
        contract_address = AUDIT_INVALID_TARGET

    raw_network_id = values.get(NETWORK_ID_ENV, DEFAULT_NETWORK_ID)
    try:
        network_id = _validate_network_id(raw_network_id)
    except RecallAdapterError:
        network_id = AUDIT_INVALID_TARGET

    return contract_address, network_id


def _validate_timeout(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise RecallAdapterError("Recall read timeout must be positive")
    return float(value)


@dataclass(frozen=True)
class _ReadOnlyAccount:
    """Address-only object required by this SDK's read request builder.

    ``genlayer-py`` uses only ``account.address`` to populate the read sender;
    no transaction is signed and no private key is loaded or required.
    """

    address: str = "0x0000000000000000000000000000000000000000"


def _default_client_factory(rpc_url: str) -> Any:
    try:
        from genlayer_py import create_client
        from genlayer_py.chains import testnet_bradbury
    except Exception as exc:
        raise RecallAdapterError("Installed genlayer-py SDK is unavailable") from exc

    try:
        return create_client(
            chain=testnet_bradbury,
            endpoint=rpc_url,
            account=cast(Any, _ReadOnlyAccount()),
        )
    except Exception as exc:
        raise RecallAdapterError("Unable to initialize the Bradbury read client") from exc


def _install_gen_call_compatibility(client: Any) -> None:
    provider: Any = getattr(client, "provider", None)
    make_request = getattr(provider, "make_request", None)
    if not callable(make_request):
        return
    if getattr(provider, "_recall_gen_call_compatibility", False):
        return

    def compatible_make_request(method: Any, params: Any) -> Any:
        response = make_request(method, params)
        if method != "gen_call":
            return response
        if not isinstance(response, dict):
            raise RecallAdapterError("Bradbury gen_call response is malformed")
        result = response.get("result")
        if isinstance(result, str):
            return response
        if not isinstance(result, dict) or not isinstance(result.get("data"), str):
            raise RecallAdapterError("Bradbury gen_call result envelope is malformed")
        normalized = dict(response)
        normalized["result"] = result["data"]
        return normalized

    provider.make_request = compatible_make_request
    setattr(provider, "_recall_gen_call_compatibility", True)


def _call_with_timeout(function: Callable[[], Any], timeout_seconds: float) -> Any:
    result_queue: queue.Queue[tuple[str, Any]] = queue.Queue(maxsize=1)

    def run() -> None:
        try:
            result_queue.put(("ok", function()))
        except Exception as exc:
            result_queue.put(("error", exc))

    worker = threading.Thread(target=run, name="recall-authorize-read", daemon=True)
    worker.start()
    worker.join(timeout_seconds)
    if worker.is_alive():
        raise RecallReadTimeout("Recall authorization read timed out")

    try:
        outcome, value = result_queue.get_nowait()
    except queue.Empty as exc:
        raise RecallAdapterError("Recall authorization read returned no result") from exc
    if outcome == "error":
        raise value
    return value


class RecallBradburyAdapter:
    """Fresh, read-only ``recall_active`` adapter for Recall."""

    def __init__(
        self,
        contract_address: str = DEFAULT_CONTRACT_ADDRESS,
        rpc_url: str = DEFAULT_RPC_URL,
        network_id: str = DEFAULT_NETWORK_ID,
        timeout_seconds: float = DEFAULT_READ_TIMEOUT_SECONDS,
        client_factory: Optional[Callable[[str], Any]] = None,
    ) -> None:
        self.contract_address = _validate_address(contract_address)
        self.rpc_url = _validate_rpc_url(rpc_url)
        self.network_id = _validate_network_id(network_id)
        self.timeout_seconds = _validate_timeout(timeout_seconds)
        self._client_factory = client_factory or _default_client_factory

    @classmethod
    def from_env(
        cls,
        environ: Optional[Mapping[str, str]] = None,
        client_factory: Optional[Callable[[str], Any]] = None,
    ) -> "RecallBradburyAdapter":
        values = os.environ if environ is None else environ
        timeout_text = values.get(
            READ_TIMEOUT_ENV, str(DEFAULT_READ_TIMEOUT_SECONDS)
        )
        try:
            timeout_seconds = float(timeout_text)
        except (TypeError, ValueError) as exc:
            raise RecallAdapterError("Recall read timeout is malformed") from exc
        return cls(
            contract_address=values.get(CONTRACT_ADDRESS_ENV, DEFAULT_CONTRACT_ADDRESS),
            rpc_url=values.get(RPC_URL_ENV, DEFAULT_RPC_URL),
            network_id=values.get(NETWORK_ID_ENV, DEFAULT_NETWORK_ID),
            timeout_seconds=timeout_seconds,
            client_factory=client_factory,
        )

    @staticmethod
    def _validate_batch_id(batch_id: int) -> int:
        if type(batch_id) is not int or batch_id < 0:
            raise RecallAdapterError("Recall batch id must be a non-negative integer")
        return batch_id

    def _read_once(self, batch_id: int) -> Any:
        client = self._client_factory(self.rpc_url)
        if client is None:
            raise RecallAdapterError("Recall read client is missing")
        _install_gen_call_compatibility(client)
        reader = getattr(client, "read_contract", None)
        if not callable(reader):
            raise RecallAdapterError("Recall read client has no read_contract method")
        try:
            from genlayer_py.types import TransactionHashVariant
        except Exception as exc:
            raise RecallAdapterError("Installed genlayer-py types are unavailable") from exc
        return reader(
            address=self.contract_address,
            function_name="recall_active",
            args=[batch_id],
            transaction_hash_variant=TransactionHashVariant.LATEST_NONFINAL,
        )

    def recall_active(self, batch_id: int) -> bool:
        """Perform one fresh latest-nonfinal read and return only an exact bool."""

        batch_id = self._validate_batch_id(batch_id)
        try:
            raw_result = _call_with_timeout(
                lambda: self._read_once(batch_id), self.timeout_seconds
            )
        except RecallReadTimeout:
            raise
        except TimeoutError as exc:
            raise RecallReadTimeout("Recall authorization read timed out") from exc
        except RecallAdapterError:
            raise
        except Exception as exc:
            raise RecallAdapterError("Recall authorization RPC read failed") from exc
        return parse_recall_active_result(raw_result)
