"""Fail-closed reference consumer for protected recall redemptions.

The caller supplies a live contract adapter whose ``recall_active(batch_id)``
method performs the actual read.  This module deliberately keeps no
authorization cache: every redemption attempt reads the contract immediately
before the downstream action.
"""

from typing import Any, Callable, TypeVar


T = TypeVar("T")


class RecallNotActive(RuntimeError):
    """The contract explicitly returned false for this batch."""


class RecallAuthorizationFailed(RuntimeError):
    """The authorization read failed or returned a non-boolean result."""


class RecallRedemptionExecutionFailed(RuntimeError):
    """Authorization succeeded but the downstream redemption failed."""


def redeem_with_recall_gate(
    recall_contract: Any,
    batch_id: int,
    downstream_action: Callable[[], T],
) -> T:
    """Authorize and execute one protected refund/replacement action.

    ``recall_contract.recall_active(batch_id)`` is called on every invocation.
    A read error, malformed read result, or explicit false blocks the action.
    Only an explicit boolean true permits the downstream action to run.
    """

    try:
        active = recall_contract.recall_active(batch_id)
    except Exception as exc:
        raise RecallAuthorizationFailed(
            "Recall authorization read failed; redemption denied"
        ) from exc

    if active is False:
        raise RecallNotActive(
            "Recall is not active for this batch; redemption denied"
        )
    if active is not True:
        raise RecallAuthorizationFailed(
            "Recall authorization returned a non-boolean result; redemption denied"
        )

    try:
        return downstream_action()
    except Exception as exc:
        raise RecallRedemptionExecutionFailed(
            "Downstream recall redemption execution failed"
        ) from exc
