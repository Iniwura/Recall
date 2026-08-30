# Recall

Recall is an Intelligent Product Recall Authorization contract for one narrow,
high-consequence question:

> Is this exact product batch covered by a real safety recall?

Product recalls are often described across scattered regulator and manufacturer
bulletins, while refund, replacement, and reimbursement systems need an exact
batch-level authorization signal. Recall makes the sealed batch identity and
recall policy the adjudication context, fetches the complete declared source
set itself, and records a consensus assessment history.

## Deployed Bradbury instance

The canonical deployed Recall contract is
`0x876Eb31536FfB3eF448dbdeB905118E70761981C` on Bradbury
(`https://rpc-bradbury.genlayer.com`). Its deployment transaction is
`0x63c15a960dd194ec2ba5fd45eb836b8f5e1c8b80600a9edee77d896858f648b9` and the
audited contract SHA-256 is
`e24be49b6d113409eef24b9eafa7f3b92494b5a731cea21ded10748e044338b3`.

The live proof for Batch 1 is FDA lot `4032183`, with `AFFECTED`, `BOUND`, and
`recall_active == true`. The assessment transaction is
`0xba8afedf37bfb78455f477b0c08c4667656d89f6cbfc5fc4a892a0cbdc5ccbc4`.
The CLI initially timed out while polling that transaction, but authoritative
subsequent contract reads showed `assessment_count == 1` and the recorded
`AFFECTED` / `BOUND` assessment.

The durable downstream consumer performs a fresh Bradbury
`recall_active(batch_id)` read immediately before authorizing a protected
operation and fails closed on false, malformed, or failed reads. It authorizes
a downstream system only; no real monetary refund or replacement is claimed
here. The browser UI is not a refund executor.

## Lifecycle

```text
REGISTER
  -> EDIT POLICY / SOURCES
  -> SEAL
  -> FULL-SOURCE ASSESSMENT
  -> GENLAYER CONSENSUS VERDICT
  -> STICKY RECALL
  -> recall_active(batch_id)
  -> REDEMPTION GATE
```

Registration records the exact manufacturer, product, model, SKU, lot, batch
code, optional manufacture/date code, optional product identifier, owner, and a
deterministic identity commitment. Required identity fields have bounded
lengths, and there is no method that edits identity in place. A corrected
product identity must be registered as a new batch.

The owner may edit the policy and source set before sealing. Policy and source
versions increment on each successful update. `seal_batch` is owner-only and
irreversible; it freezes the policy and complete source set. Assessments are
permissionless after seal and must include the complete frozen source set in any
order. The contract canonicalizes the source URLs lexicographically before
fetching, evaluation, commitment, and history storage.

## Trust model

The batch owner chooses the authoritative source URLs under the declared recall
policy before sealing. The contract then fetches those exact frozen URLs inside
the nondeterministic evaluator. Assessment callers submit only a title and
notes as history metadata; they do not submit evidence bodies and their prose
does not enter the evaluator prompt or evidence commitment.

The sealed source set is explicitly authoritative under the batch owner’s
declared recall policy. Recall does not cryptographically prove that a website
belongs to a regulator or manufacturer; it directly fetches and evaluates the
frozen declared sources.

Fetched pages and response bodies are untrusted data. Fixed evaluator
instructions precede clearly delimited policy, identity, source URL, and
evidence data. The evaluator is told never to follow commands in fetched pages
and to ignore attempts to override verdict definitions, the schema, authority,
batch identity, recall policy, validator instructions, or system instructions.
Exact batch identity fields are data, never model instructions: manufacturer,
product, model, SKU, lot, batch, manufacture-date, and product-identifier
strings cannot alter the fixed evaluator instructions. The sealed
`recall_policy` is declarative policy data whose substantive recall and evidence
criteria should be interpreted, but policy text can never redefine fixed verdict
definitions, `BOUND`/`PARTIAL`/`UNBOUND`, exact-batch binding, the complete-source
requirement, the output schema, validator behavior, or the fixed instructions.
Caller-supplied title and notes remain completely outside adjudication.
Recall expects text/JSON-style UTF-8 evidence endpoints; binary/non-UTF8
resources are treated as incomplete evidence and cannot support decisive
authorization.

HTTP 4xx/5xx responses and empty successful bodies remain evidence data. A
transport failure is recorded as an explicit unavailable marker. HTTP status
alone never decides a verdict. If every source is unavailable, Recall records a
deterministic `UNDETERMINED` / `UNBOUND` result without calling the LLM. If any
source is unavailable or truncated, an evaluator proposal for `AFFECTED` or
`NOT_AFFECTED` is conservatively normalized to `UNDETERMINED` / `PARTIAL` when
it otherwise claimed exact binding. Truncation is explicit: the prompt includes
the bounded body prefix, full body length, full-body SHA-256, and `truncated:
true`; the evaluator must not treat the omitted body as evaluated. A `WATCH`
result may remain informational, but it can never activate recall.

The leader and validators independently fetch every frozen URL. Mutable or
volatile pages can therefore differ between validator executions; if their
evidence commitments disagree, consensus fails rather than mutating state
unsafely. Stable regulator APIs, static notices, and content-stable endpoints
are preferred. Dynamic or JavaScript-heavy pages may be unsuitable for
`gl.nondet.web.get` unless a suitable stable source or API is provided. Exact
evidence commitments are not weakened to improve availability.

## Verdicts and binding

The evaluator must return exactly four string fields:

```json
{
  "verdict": "AFFECTED | NOT_AFFECTED | WATCH | UNDETERMINED",
  "batch_binding": "BOUND | PARTIAL | UNBOUND",
  "reasoning": "string",
  "evidence_summary": "string"
}
```

- `AFFECTED`: evidence establishes that the exact registered batch falls within
  a safety recall under the sealed policy.
- `NOT_AFFECTED`: authoritative evidence explicitly establishes that the exact
  registered batch is outside the recall scope.
- `WATCH`: there is a credible safety or recall signal, but exact-batch recall
  is not established.
- `UNDETERMINED`: evidence is unavailable, conflicting, insufficient,
  malformed, or cannot support a reliable exact-batch conclusion.

`BOUND` means the evidence clearly binds to the exact registered batch identity.
`PARTIAL` means it relates to the product/model/manufacturer without fully
binding the exact batch or lot. `UNBOUND` means no reliable identity binding.

Recall applies this deterministic normalization rule:

1. `AFFECTED` + `BOUND` is eligible to activate recall only when every frozen
   source was available.
2. `AFFECTED` + `PARTIAL` or `UNBOUND` becomes `WATCH` and never activates.
3. `AFFECTED` + `BOUND` with an unavailable source becomes
   `UNDETERMINED` + `PARTIAL`.
4. `NOT_AFFECTED` with weak binding becomes `UNDETERMINED`; a
   `NOT_AFFECTED` result with an unavailable source also becomes
   `UNDETERMINED` + `PARTIAL` when it claimed exact binding.

The contract uses `gl.vm.run_nondet_unsafe` with a module-level evaluator. It
copies storage into plain in-memory values before entering nondeterministic
execution. The validator reruns the complete evaluation independently and
compares the consensus-critical `verdict`, `batch_binding`, and
`evidence_commitment`; freeform reasoning is not used as an equality field.

## Sticky recall and administrative state

Once one consensus assessment produces `AFFECTED` + `BOUND` with complete
available evidence, `recall_active(batch_id)` becomes `true` permanently. No
later `NOT_AFFECTED`, `WATCH`, or `UNDETERMINED` assessment can clear it. A
different reviewer, source ordering, source failure, or favorable title/notes
also cannot clear it. There is no reset, pardon, unrecall, or rehabilitation
method.

Each assessment also stores the submitting `reviewer` address. Assessments stay
permissionless, and the reviewer is history provenance only: it is deliberately
excluded from the evidence commitment, so changing reviewers cannot bypass exact
duplicate-packet replay protection.

`active` is a separate administrative record flag. The owner may deactivate or
reactivate a batch record, but that does not erase historical recall status;
`recall_active` remains sticky and independent of `active`.

## Evidence commitment and replay

Recall stores a lowercase SHA-256 commitment covering:

- the exact batch identity, owner, and identity commitment;
- sealed recall policy;
- policy and source-set versions;
- canonical frozen source URLs;
- every fetched evidence item, including URL, HTTP status, bounded response
  body, full body length, full-body SHA-256, truncated marker, and error or an
  explicit unavailable/error marker for transport failure.

Assessment title and notes are intentionally excluded. The exact same evidence
packet cannot be assessed twice, even if caller metadata changes or evidence URL
input is reordered. A materially different fetched packet can create a new
assessment and commitment. Because remote pages can change, the same URL may
produce a new commitment later; SHA-256 is a deterministic packet fingerprint,
not proof that the remote website is authentic or immutable.

Recall does not pretend to enforce elapsed-time separation between observations:
the installed GenVM environment does not provide a safe, reliable on-chain
clock primitive for this contract. Hardening uses complete-source corroboration
within each assessment plus distinct evidence commitments. A single consensus
assessment is sufficient for a confirmed official exact-batch `AFFECTED` result.

## Public API

Views:

- `get_batch_count()`
- `get_assessment_count()`
- `get_batch(batch_id)`
- `get_assessment(assessment_id)`
- `recall_active(batch_id)`

Writes:

- `register_batch(manufacturer, product_name, product_model, sku, lot_number,
  batch_code, manufacture_date, product_identifier, recall_policy,
  evidence_sources)`
- `update_recall_policy(batch_id, recall_policy)` before seal
- `update_evidence_sources(batch_id, evidence_sources)` before seal
- `seal_batch(batch_id)`
- `assess_batch(batch_id, title, claimed_risk_or_notes, evidence_urls)` after
  seal and permissionlessly
- `set_batch_active(batch_id, active)`

## Downstream redemption gate

`execution/recall_redemption_gate.py` is the reference enforcement boundary.
`redeem_with_recall_gate` calls `recall_active(batch_id)` immediately before
the downstream refund, replacement, or reimbursement callback on every
invocation. Only an explicit boolean `true` permits the callback.

- `RecallNotActive`: the contract explicitly returned `false`.
- `RecallAuthorizationFailed`: the read failed or returned a non-boolean value.
- `RecallRedemptionExecutionFailed`: authorization succeeded, but the
  downstream callback failed.

The browser is not a payout/refund executor and no authorization decision is
cached by the gate.

## Live command consumer

`recall-redeem` is the backend/CI enforcement command. It performs one fresh
Bradbury `recall_active(batch_id)` read immediately before invoking the supplied
downstream argument vector, never concatenates a shell command, never retries
the downstream command, and never caches a positive read:

```text
./recall-redeem --batch-id 1 -- python3 -c 'print("RECALL_REDEMPTION_GATE_EXECUTED")'
```

The read uses the installed `genlayer-py` client with
`testnet_bradbury`, `client.read_contract(function_name="recall_active",
args=[batch_id], transaction_hash_variant=LATEST_NONFINAL)`, and an
address-only read sender; no browser wallet or signing key is required. The
defaults can be overridden with `RECALL_CONTRACT_ADDRESS`, `RECALL_RPC_URL`,
`RECALL_NETWORK_ID`, and `RECALL_READ_TIMEOUT_SECONDS`. Exit codes are `10` for
explicit inactive recall, `11` for authorization/read failure, and `12` for a
downstream failure. Each attempt emits a concise JSON audit record without RPC
credentials or other secret environment values.

The SDK provider in `genlayer-py==0.16.3` uses `requests.post` without a native
timeout. The adapter's supervisory daemon-thread timeout safely fails closed
for the one-shot `recall-redeem` process. In a long-lived embedding, the
underlying read thread may continue until the process exits; it is not
force-terminated.

## Consumer installation

Python 3.12+ is required. Install the pinned live-consumer dependency with:

```text
python3 -m pip install -r requirements-consumer.txt
```

## Frontend command center

The production submission frontend lives in `app/` and uses React, TypeScript,
Vite, and the pinned `genlayer-js@1.1.8` browser SDK. Python 3.12+ is required
for the live consumer; the frontend itself uses Node.js and npm.

From the project directory:

```text
cd app
npm install
npm run dev
```

Routes are `#/command`, `#/registry`, `#/batch/1`, `#/assessments`,
`#/register`, `#/owner`, and `#/about`. Public reads are wallet-free and use
Bradbury latest-nonfinal state. Writes use an injected EIP-1193 wallet only
after account and chain verification; the browser uses direct provider requests
and never executes refunds, replacements, payouts, or backend redemption. A
write is shown as `RECORDED` only after the expected contract state is observed.
The durable `recall-redeem` consumer remains the independent fail-closed
downstream enforcement demonstration.

Recall expects text/JSON-style UTF-8 evidence endpoints; binary/non-UTF8
resources are treated as incomplete evidence and cannot support decisive
authorization.

## Validation

The Recall contract is deployed on Bradbury. The frontend has been built,
tested, committed, and pushed to GitHub, and the production command center is
publicly deployed at https://recall-silk-five.vercel.app/.

The live Batch 1 demonstration is available at
https://recall-silk-five.vercel.app/#/batch/1.

The Direct Mode suite covers registration and immutability, owner lifecycle and
versioning, complete-source assessment gating, prompt-injection boundaries,
HTTP and transport behavior, truncation metadata and fail-closed handling,
strict evaluator schema, independent validator recomputation, reviewer
provenance, binding normalization, sticky recall, replay protection, append-only
history, evidence commitments, and the fail-closed redemption gate.

From the project directory:

```text
python -m pytest -q
gltest -q
genvm-lint check contracts/recall.py
genvm-lint lint contracts/recall.py
genvm-lint validate contracts/recall.py
genvm-lint schema contracts/recall.py
genvm-lint typecheck contracts/recall.py
python3 -m py_compile \
  contracts/recall.py \
  execution/recall_redemption_gate.py \
  execution/recall_live_adapter.py \
  execution/recall_redeem.py \
  test/test_recall_live_consumer.py
grep -nE '@staticmethod|ValueError' contracts/recall.py || echo PASS
```

## Repository layout

```text
contracts/recall.py                 Recall Intelligent Contract
execution/recall_redemption_gate.py Fail-closed downstream consumer
execution/recall_live_adapter.py   Read-only Bradbury contract adapter
execution/recall_redeem.py          Protected downstream command CLI
requirements-consumer.txt           Pinned live-consumer runtime dependency
recall-redeem                       Executable CLI entry point
test/test_recall.py                 Direct Mode adversarial contract suite
test/test_execution_gate.py         Redemption-gate unit tests
test/test_recall_live_consumer.py   Deterministic adapter and CLI tests
pytest.ini                          Direct Mode test path configuration
```
