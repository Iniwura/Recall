import io
import json
import subprocess
import time
from typing import Any

import pytest

from execution import recall_redeem
from execution.recall_live_adapter import (
    AUDIT_INVALID_TARGET,
    CONTRACT_ADDRESS_ENV,
    DEFAULT_CONTRACT_ADDRESS,
    DEFAULT_NETWORK_ID,
    DEFAULT_RPC_URL,
    NETWORK_ID_ENV,
    READ_TIMEOUT_ENV,
    RecallAdapterError,
    RecallBradburyAdapter,
    RecallReadTimeout,
    RPC_URL_ENV,
    parse_recall_active_result,
)


class FakeClient:
    def __init__(self, result: Any = True):
        self.result = result
        self.calls = []

    def read_contract(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.result, BaseException):
            raise self.result
        if callable(self.result):
            return self.result()
        return self.result


class FakeAdapter:
    contract_address = DEFAULT_CONTRACT_ADDRESS
    network_id = DEFAULT_NETWORK_ID
    rpc_url = "https://rpc.example.invalid"

    def __init__(self, result: Any = True):
        self.result = result
        self.calls = []

    def recall_active(self, batch_id):
        self.calls.append(batch_id)
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


def make_adapter(result: Any = True, timeout_seconds: float = 1.0):
    client = FakeClient(result)
    adapter = RecallBradburyAdapter(
        client_factory=lambda _rpc_url: client,
        timeout_seconds=timeout_seconds,
    )
    return adapter, client


def audit_record(stream):
    return json.loads(stream.getvalue())


def test_parser_accepts_only_exact_boolean_values():
    assert parse_recall_active_result(True) is True
    assert parse_recall_active_result(False) is False
    for malformed in [None, "true", "false", 1, 0, {}, []]:
        with pytest.raises(RecallAdapterError):
            parse_recall_active_result(malformed)


def test_adapter_uses_latest_nonfinal_read_and_canonical_defaults():
    adapter, client = make_adapter(True)
    assert adapter.contract_address == DEFAULT_CONTRACT_ADDRESS
    assert adapter.rpc_url == DEFAULT_RPC_URL
    assert adapter.network_id == DEFAULT_NETWORK_ID
    assert adapter.recall_active(1) is True
    assert client.calls[0]["function_name"] == "recall_active"
    assert client.calls[0]["args"] == [1]
    assert client.calls[0]["transaction_hash_variant"].value == "latest-nonfinal"


def test_adapter_environment_overrides_are_explicit_and_read_only():
    address = "0x" + "ab" * 20
    environment = {
        CONTRACT_ADDRESS_ENV: address,
        RPC_URL_ENV: "https://rpc.override.example",
        NETWORK_ID_ENV: "Bradbury-test-override",
        READ_TIMEOUT_ENV: "3.5",
    }
    client = FakeClient(False)
    adapter = RecallBradburyAdapter.from_env(
        environment, client_factory=lambda _rpc_url: client
    )
    assert adapter.contract_address == address
    assert adapter.rpc_url == environment[RPC_URL_ENV]
    assert adapter.network_id == environment[NETWORK_ID_ENV]
    assert adapter.timeout_seconds == 3.5
    assert adapter.recall_active(1) is False


@pytest.mark.parametrize("result", [None, "true", "false", 1, 0, {}, [], ""])
def test_malformed_or_empty_sdk_results_fail_closed(result):
    adapter, _client = make_adapter(result)
    with pytest.raises(RecallAdapterError):
        adapter.recall_active(1)


@pytest.mark.parametrize("failure", [RuntimeError("rpc down"), ValueError("decode")])
def test_rpc_and_decode_failures_fail_closed(failure):
    adapter, _client = make_adapter(failure)
    with pytest.raises(RecallAdapterError):
        adapter.recall_active(1)


def test_timeout_fails_closed():
    def slow_result():
        time.sleep(0.05)
        return True

    adapter, _client = make_adapter(slow_result, timeout_seconds=0.001)
    with pytest.raises(RecallReadTimeout):
        adapter.recall_active(1)


def test_timeout_exception_from_rpc_fails_closed():
    adapter, _client = make_adapter(TimeoutError("request timeout"))
    with pytest.raises(RecallReadTimeout):
        adapter.recall_active(1)


def test_positive_authorization_is_never_cached():
    values = iter([True, False])
    adapter, _client = make_adapter(lambda: next(values))
    assert adapter.recall_active(1) is True
    assert adapter.recall_active(1) is False


def test_adapter_rejects_invalid_configuration():
    with pytest.raises(RecallAdapterError):
        RecallBradburyAdapter(contract_address="not-an-address")
    with pytest.raises(RecallAdapterError):
        RecallBradburyAdapter(rpc_url="not-a-url")
    with pytest.raises(RecallAdapterError):
        RecallBradburyAdapter.from_env({READ_TIMEOUT_ENV: "not-a-number"})


def test_cli_blocks_explicit_false_without_running_command():
    adapter = FakeAdapter(False)
    calls = []
    audit = io.StringIO()

    def should_not_run(*_args, **_kwargs):
        calls.append(True)

    exit_code = recall_redeem.main(
        ["--batch-id", "1", "--", "python3", "-c", "print('no')"],
        adapter=adapter,
        run_command=should_not_run,
        audit_stream=audit,
    )
    assert exit_code == recall_redeem.EXIT_NOT_ACTIVE
    assert adapter.calls == [1]
    assert calls == []
    record = audit_record(audit)
    assert record["authorization_result"] == "false"
    assert record["downstream_result"] == "blocked"


def test_cli_blocks_authorization_error_without_running_command():
    adapter = FakeAdapter(RuntimeError("rpc failure"))
    calls = []
    audit = io.StringIO()

    exit_code = recall_redeem.main(
        ["--batch-id", "1", "--", "python3", "-c", "print('no')"],
        adapter=adapter,
        run_command=lambda *_args, **_kwargs: calls.append(True),
        audit_stream=audit,
    )
    assert exit_code == recall_redeem.EXIT_AUTHORIZATION_FAILED
    assert adapter.calls == [1]
    assert calls == []
    record = audit_record(audit)
    assert record["authorization_result"] == "error"
    assert record["downstream_result"] == "blocked"


def test_cli_runs_authorized_downstream_exactly_once_with_separate_arguments():
    adapter = FakeAdapter(True)
    calls = []
    audit = io.StringIO()
    command = [
        "python3",
        "-c",
        "print('safe; still one argument')",
        "argument with spaces",
        "$(do-not-run)",
    ]

    def fake_run(received, check):
        calls.append((received, check))

    exit_code = recall_redeem.main(
        ["--batch-id", "1", "--"] + command,
        adapter=adapter,
        run_command=fake_run,
        audit_stream=audit,
    )
    assert exit_code == 0
    assert adapter.calls == [1]
    assert calls == [(command, True)]
    record = audit_record(audit)
    assert record["authorization_result"] == "true"
    assert record["downstream_result"] == "succeeded"


def test_cli_distinguishes_downstream_failure_and_does_not_retry():
    adapter = FakeAdapter(True)
    calls = []
    audit = io.StringIO()
    command = ["python3", "-c", "raise SystemExit(7)"]

    def failing_run(received, check):
        calls.append((received, check))
        raise subprocess.CalledProcessError(7, received)

    exit_code = recall_redeem.main(
        ["--batch-id", "1", "--"] + command,
        adapter=adapter,
        run_command=failing_run,
        audit_stream=audit,
    )
    assert exit_code == recall_redeem.EXIT_DOWNSTREAM_FAILED
    assert adapter.calls == [1]
    assert calls == [(command, True)]
    record = audit_record(audit)
    assert record["authorization_result"] == "true"
    assert record["downstream_result"] == "failed"


def test_audit_contains_required_fields_but_not_rpc_or_secret_values():
    adapter = FakeAdapter(True)
    adapter.rpc_url = "https://user:SUPER_SECRET@rpc.example.invalid"
    audit = io.StringIO()
    exit_code = recall_redeem.main(
        ["--batch-id", "1", "--", "echo", "ok"],
        adapter=adapter,
        run_command=lambda *_args, **_kwargs: None,
        audit_stream=audit,
    )
    assert exit_code == 0
    output = audit.getvalue()
    record = audit_record(audit)
    assert set(record) == {
        "authorization_result",
        "batch_id",
        "contract_address",
        "downstream_result",
        "network",
        "utc_timestamp",
    }
    assert record["contract_address"] == DEFAULT_CONTRACT_ADDRESS
    assert record["network"] == DEFAULT_NETWORK_ID
    assert "SUPER_SECRET" not in output
    assert adapter.rpc_url not in output


def test_failed_default_initialization_is_attributed_to_canonical_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(CONTRACT_ADDRESS_ENV, raising=False)
    monkeypatch.delenv(NETWORK_ID_ENV, raising=False)

    def fail_from_env(_cls: type[RecallBradburyAdapter]) -> RecallBradburyAdapter:
        raise RecallAdapterError("configuration failure")

    monkeypatch.setattr(
        RecallBradburyAdapter,
        "from_env",
        classmethod(fail_from_env),
    )
    audit_stream = io.StringIO()

    result = recall_redeem.main(
        ["--batch-id", "17", "--", "echo", "blocked"],
        adapter=None,
        run_command=lambda _command: pytest.fail("blocked initialization ran command"),
        audit_stream=audit_stream,
    )

    assert result == recall_redeem.EXIT_AUTHORIZATION_FAILED
    record = json.loads(audit_stream.getvalue())
    assert record["contract_address"] == DEFAULT_CONTRACT_ADDRESS
    assert record["network"] == DEFAULT_NETWORK_ID


def test_failed_initialization_is_attributed_to_valid_target_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    override_address = "0x" + "cd" * 20
    monkeypatch.setenv(CONTRACT_ADDRESS_ENV, override_address)
    monkeypatch.setenv(NETWORK_ID_ENV, "Bradbury-staging")

    def fail_from_env(_cls: type[RecallBradburyAdapter]) -> RecallBradburyAdapter:
        raise RecallAdapterError("configuration failure")

    monkeypatch.setattr(
        RecallBradburyAdapter,
        "from_env",
        classmethod(fail_from_env),
    )
    audit_stream = io.StringIO()

    result = recall_redeem.main(
        ["--batch-id", "18", "--", "echo", "blocked"],
        adapter=None,
        run_command=lambda _command: pytest.fail("blocked initialization ran command"),
        audit_stream=audit_stream,
    )

    assert result == recall_redeem.EXIT_AUTHORIZATION_FAILED
    record = json.loads(audit_stream.getvalue())
    assert record["contract_address"] == override_address
    assert record["network"] == "Bradbury-staging"
    assert record["contract_address"] != DEFAULT_CONTRACT_ADDRESS


def test_malformed_target_configuration_is_not_attributed_to_canonical_recall(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(CONTRACT_ADDRESS_ENV, "not-a-contract-address")
    monkeypatch.setenv(NETWORK_ID_ENV, "")

    def fail_from_env(_cls: type[RecallBradburyAdapter]) -> RecallBradburyAdapter:
        raise RecallAdapterError("configuration failure")

    monkeypatch.setattr(
        RecallBradburyAdapter,
        "from_env",
        classmethod(fail_from_env),
    )
    audit_stream = io.StringIO()

    result = recall_redeem.main(
        ["--batch-id", "19", "--", "echo", "blocked"],
        adapter=None,
        run_command=lambda _command: pytest.fail("blocked initialization ran command"),
        audit_stream=audit_stream,
    )

    assert result == recall_redeem.EXIT_AUTHORIZATION_FAILED
    record = json.loads(audit_stream.getvalue())
    assert record["contract_address"] == AUDIT_INVALID_TARGET
    assert record["network"] == AUDIT_INVALID_TARGET
    assert record["contract_address"] != DEFAULT_CONTRACT_ADDRESS


def test_failed_initialization_never_logs_rpc_url_credentials_or_secret_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rpc_url = "https://rpc-user:embedded-secret@rpc.example.invalid/genlayer"
    monkeypatch.setenv(RPC_URL_ENV, rpc_url)
    monkeypatch.setenv("RECALL_PRIVATE_KEY", "should-never-appear")

    def fail_from_env(_cls: type[RecallBradburyAdapter]) -> RecallBradburyAdapter:
        raise RecallAdapterError("configuration failure")

    monkeypatch.setattr(
        RecallBradburyAdapter,
        "from_env",
        classmethod(fail_from_env),
    )
    audit_stream = io.StringIO()

    result = recall_redeem.main(
        ["--batch-id", "20", "--", "echo", "blocked"],
        adapter=None,
        run_command=lambda _command: pytest.fail("blocked initialization ran command"),
        audit_stream=audit_stream,
    )

    assert result == recall_redeem.EXIT_AUTHORIZATION_FAILED
    output = audit_stream.getvalue()
    assert rpc_url not in output
    assert "rpc-user" not in output
    assert "embedded-secret" not in output
    assert "should-never-appear" not in output


def test_sdk_bradbury_data_envelope_is_unwrapped_before_sdk_decode():
    from genlayer_py.abi import calldata

    class Provider:
        def make_request(self, method, _params):
            assert method == "gen_call"
            return {"jsonrpc": "2.0", "result": {"data": "10"}}

    class Client:
        provider = Provider()

        def read_contract(self, **_kwargs):
            response = self.provider.make_request("gen_call", [])
            return calldata.decode(bytes.fromhex(response["result"]))

    adapter = RecallBradburyAdapter(client_factory=lambda _rpc_url: Client())
    assert adapter.recall_active(1) is True
