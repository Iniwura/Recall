import pytest

from execution.recall_redemption_gate import (
    RecallAuthorizationFailed,
    RecallNotActive,
    RecallRedemptionExecutionFailed,
    redeem_with_recall_gate,
)


class FakeRecall:
    def __init__(self, value=True, error=None):
        self.value = value
        self.error = error
        self.calls = []

    def recall_active(self, batch_id):
        self.calls.append(batch_id)
        if self.error is not None:
            raise self.error
        return self.value


def test_active_recall_allows_downstream_redemption():
    recall = FakeRecall(True)
    actions = []
    result = redeem_with_recall_gate(
        recall, 7, lambda: actions.append("refund") or "receipt-7"
    )
    assert result == "receipt-7"
    assert actions == ["refund"]
    assert recall.calls == [7]


def test_explicit_false_blocks_without_calling_downstream():
    recall = FakeRecall(False)
    actions = []
    with pytest.raises(RecallNotActive):
        redeem_with_recall_gate(recall, 7, lambda: actions.append("must-not-run"))
    assert actions == []
    assert recall.calls == [7]


def test_read_exception_fails_closed_as_authorization_failure():
    recall = FakeRecall(error=OSError("RPC unavailable"))
    actions = []
    with pytest.raises(RecallAuthorizationFailed):
        redeem_with_recall_gate(recall, 7, lambda: actions.append("must-not-run"))
    assert actions == []
    assert recall.calls == [7]


@pytest.mark.parametrize("value", [None, 1, "true", []])
def test_non_boolean_read_fails_closed(value):
    recall = FakeRecall(value)
    with pytest.raises(RecallAuthorizationFailed):
        redeem_with_recall_gate(recall, 7, lambda: "must-not-run")
    assert recall.calls == [7]


def test_downstream_failure_is_distinct_from_authorization_failure():
    recall = FakeRecall(True)

    def broken_redemption():
        raise ConnectionError("payment processor unavailable")

    with pytest.raises(RecallRedemptionExecutionFailed):
        redeem_with_recall_gate(recall, 7, broken_redemption)
    assert recall.calls == [7]


def test_gate_performs_a_fresh_read_on_every_invocation():
    recall = FakeRecall(True)
    redeem_with_recall_gate(recall, 7, lambda: "first")
    recall.value = False
    with pytest.raises(RecallNotActive):
        redeem_with_recall_gate(recall, 7, lambda: "must-not-run")
    assert recall.calls == [7, 7]
