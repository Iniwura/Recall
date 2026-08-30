import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  LIMITS,
  NETWORK_CHAIN_ID,
  NETWORK_NAME,
} from "./constants";
import {
  createWalletClient,
  loadAssessmentHistory,
  loadBatchDetail,
  loadRegistry,
  readAssessment,
  readAssessmentCount,
  readBatch,
  readBatchCount,
} from "./gateway";
import {
  deriveActiveRecallCount,
  deriveBatchStatus,
  errorMessage,
  formatCount,
  formatDate,
  formatOptionalText,
  hostnameFromUrl,
  shortHash,
  statusTone,
} from "./format";
import {
  assessmentMatchesSubmission,
  batchMatchesRegistration,
  boundedNewRecordIds,
  policyUpdateMatches,
  sourcesUpdateMatches,
  type AssessmentConfirmation,
  type RegistrationConfirmation,
} from "./confirmation";
import { exactLatestAssessment } from "./history";
import {
  activeArgs,
  assessmentArgs,
  policyArgs,
  registerArgs,
  sourcesArgs,
  type RegisterFormValues,
} from "./payloads";
import { validateEvidenceSources, validateRecallPolicy } from "./validation";
import {
  connectWallet,
  getInjectedProvider,
  parseChainId,
  readWalletState,
  shortAddress,
  validateFreshWalletState,
  walletAddressFromAccounts,
  watchWallet,
  type Eip1193Provider,
  type WalletState,
} from "./wallet";
import {
  executeTruthfulWrite,
  STAGE_LABELS,
  type TransactionProgress,
} from "./transaction";
import type { Assessment, Batch, RegistryRow } from "./types";

type Route =
  | { name: "overview" }
  | { name: "registry" }
  | { name: "batch"; id: number }
  | { name: "assessments" }
  | { name: "register" }
  | { name: "owner" }
  | { name: "about" };

type ScreenProps = {
  navigate: (path: string) => void;
  wallet: WalletState;
  performWrite: PerformWrite;
  refreshToken: number;
};

type PerformWrite = (
  functionName: string,
  args: unknown[],
  expectedState: () => Promise<boolean>,
) => Promise<string>;

const navigation = [
  { path: "#/command", label: "Command / Overview", marker: "01" },
  { path: "#/registry", label: "Batch Registry", marker: "02" },
  { path: "#/assessments", label: "Assessment History", marker: "03" },
  { path: "#/register", label: "Register Batch", marker: "04" },
  { path: "#/owner", label: "Owner Controls", marker: "05" },
  { path: "#/about", label: "About / Architecture", marker: "06" },
];

function parseRoute(): Route {
  const hash = window.location.hash || "#/command";
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "registry") return { name: "registry" };
  if (parts[0] === "assessments") return { name: "assessments" };
  if (parts[0] === "register") return { name: "register" };
  if (parts[0] === "owner") return { name: "owner" };
  if (parts[0] === "about") return { name: "about" };
  if (parts[0] === "batch") {
    const id = Number(parts[1]);
    if (Number.isInteger(id) && id > 0) return { name: "batch", id };
  }
  return { name: "overview" };
}

function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [wallet, setWallet] = useState<WalletState>(() => {
    const provider = getInjectedProvider();
    return {
      provider,
      address: null,
      chainId: null,
      status: provider ? "disconnected" : "unavailable",
    };
  });
  const [txProgress, setTxProgress] = useState<TransactionProgress | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const navigate = useCallback((path: string) => {
    window.location.hash = path.replace(/^#/, "#");
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;
    let disposed = false;
    const sync = async () => {
      try {
        const state = await readWalletState(provider);
        if (!disposed) setWallet({ provider, ...state });
      } catch (error) {
        if (!disposed) {
          setWallet({
            provider,
            address: null,
            chainId: null,
            status: "disconnected",
            error: errorMessage(error),
          });
        }
      }
    };
    void sync();
    return watchWallet(
      provider,
      (accounts) => {
        const address = walletAddressFromAccounts(accounts);
        setWallet((current) => ({
          ...current,
          address,
          status: address
            ? current.chainId === NETWORK_CHAIN_ID
              ? "connected"
              : "wrong-network"
            : "disconnected",
          error: undefined,
        }));
      },
      (chainId) => {
        const parsed = parseChainId(chainId);
        setWallet((current) => ({
          ...current,
          chainId: Number.isFinite(parsed) ? parsed : null,
          status:
            current.address && parsed === NETWORK_CHAIN_ID
              ? "connected"
              : current.address
                ? "wrong-network"
                : "disconnected",
        }));
      },
    );
  }, []);

  const connect = async () => {
    const provider = wallet.provider ?? getInjectedProvider();
    if (!provider) {
      setWallet((current) => ({ ...current, status: "unavailable", error: "No injected wallet was detected." }));
      return;
    }
    try {
      setWallet((current) => ({ ...current, provider, error: undefined }));
      setWallet({ provider, address: null, chainId: null, status: "disconnected" });
      setWallet(await connectWallet(provider));
    } catch (error) {
      setWallet((current) => ({ ...current, provider, error: errorMessage(error) }));
    }
  };

  const performWrite = useCallback<PerformWrite>(
    async (functionName, args, expectedState) => {
      if (!wallet.provider || !wallet.address) {
        const message = wallet.status === "wrong-network"
          ? "Connect a wallet on GenLayer Bradbury before writing."
          : "Connect an injected wallet before writing.";
        setTxProgress({ stage: "FAILED", detail: message });
        throw new Error(message);
      }
      const provider = wallet.provider;
      const expectedAddress = wallet.address;
      let freshState: Awaited<ReturnType<typeof readWalletState>>;
      try {
        freshState = await readWalletState(provider);
      } catch (error) {
        const message = errorMessage(error);
        setWallet({ provider, address: null, chainId: null, status: "disconnected", error: message });
        setTxProgress({ stage: "FAILED", detail: message });
        throw new Error(message);
      }
      const freshStateError = validateFreshWalletState(freshState, expectedAddress);
      setWallet({ provider, ...freshState, error: freshStateError ?? undefined });
      if (freshStateError || !freshState.address) {
        const message = freshStateError ?? "Wallet did not return a valid account.";
        setTxProgress({ stage: "FAILED", detail: message });
        throw new Error(message);
      }
      const client = createWalletClient(provider, freshState.address);
      const hash = await executeTruthfulWrite({
        client,
        address: CONTRACT_ADDRESS,
        functionName,
        args,
        expectedState,
        onProgress: setTxProgress,
      });
      setRefreshToken((value) => value + 1);
      return hash;
    },
    [wallet],
  );

  let content: ReactNode;
  if (route.name === "overview") content = <OverviewScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} />;
  if (route.name === "registry") content = <RegistryScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} />;
  if (route.name === "batch") content = <BatchDetailScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} batchId={route.id} />;
  if (route.name === "assessments") content = <AssessmentHistoryScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} />;
  if (route.name === "register") content = <RegisterScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} />;
  if (route.name === "owner") content = <OwnerControlsScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} />;
  if (route.name === "about") content = <AboutScreen {...screenProps(navigate, wallet, performWrite, refreshToken)} />;

  return (
    <div className="app-frame">
      <header className="topbar">
        <button className="wordmark" onClick={() => navigate("#/command")} aria-label="Go to Recall command overview">
          <span className="wordmark-mark">R/</span>
          <span>RECALL</span>
        </button>
        <div className="topbar-context">
          <span className="status-dot" aria-hidden="true" />
          <span>BRADBURY / COMMAND LINK</span>
        </div>
        <div className="topbar-wallet">
          {wallet.status === "connected" ? (
            <span className="wallet-address"><span className="status-dot good" />{shortAddress(wallet.address)}</span>
          ) : (
            <button className="button button-quiet button-small" onClick={() => void connect()}>
              {wallet.status === "wrong-network" ? "SWITCH TO BRADBURY" : "CONNECT WALLET"}
            </button>
          )}
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-intro">
            <span className="eyebrow">PRODUCT SAFETY SYSTEM</span>
            <p>Evidence-led recall authorization for exact registered batches.</p>
          </div>
          <nav aria-label="Primary navigation">
            {navigation.map((item) => {
              const active = isRouteActive(route, item.path);
              return (
                <button key={item.path} className={`nav-item ${active ? "active" : ""}`} onClick={() => navigate(item.path)} aria-current={active ? "page" : undefined}>
                  <span className="nav-marker">{item.marker}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <span className="eyebrow">LIVE CONTRACT</span>
            <button className="mono-link" onClick={() => void copyText(CONTRACT_ADDRESS)}>{shortHash(CONTRACT_ADDRESS, 7, 5)}</button>
            <span className="muted">Bradbury · chain {NETWORK_CHAIN_ID}</span>
          </div>
        </aside>
        <main className="main-content">{content}</main>
      </div>
      {wallet.error && <div className="floating-notice danger" role="alert">{wallet.error}</div>}
      {txProgress && <TransactionTray progress={txProgress} onDismiss={() => setTxProgress(null)} />}
    </div>
  );
}

function screenProps(navigate: ScreenProps["navigate"], wallet: WalletState, performWrite: PerformWrite, refreshToken: number): ScreenProps {
  return { navigate, wallet, performWrite, refreshToken };
}

function isRouteActive(route: Route, path: string): boolean {
  if (path === "#/command") return route.name === "overview" || route.name === "batch";
  return path.includes(route.name);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard) await navigator.clipboard.writeText(value);
}

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
      {children && <div className="page-header-side">{children}</div>}
    </div>
  );
}

function StatusChip({ status, tone }: { status: string; tone?: "critical" | "safe" | "watch" | "unknown" }) {
  return <span className={`status-chip ${tone ?? "unknown"}`}><span className="status-chip-dot" />{status}</span>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span className="eyebrow">{label}</span><strong>{value}</strong>{detail && <span className="metric-detail">{detail}</span>}</div>;
}

function ReadUnavailable({ message = "UNKNOWN / READ UNAVAILABLE" }: { message?: string }) {
  return <div className="empty-state"><span className="empty-index">!</span><strong>{message}</strong><p>Authoritative contract state could not be read. No safe-looking default is being inferred.</p></div>;
}

function LoadingState({ label = "READING AUTHORITATIVE STATE" }: { label?: string }) {
  return <div className="loading-state"><span className="loading-line" /><span>{label}</span></div>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="copy-button" onClick={() => { void copyText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }); }}>{copied ? "COPIED" : "COPY"}</button>;
}

function OverviewScreen({ navigate, refreshToken }: ScreenProps) {
  const [state, setState] = useState<{ rows: RegistryRow[]; count: number; activeCount: number | null } | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let mounted = true;
    void loadRegistry().then((result) => {
      if (!mounted) return;
      setState({ rows: result.rows, count: result.count, activeCount: deriveActiveRecallCount(result.rows, result.capped) });
      setError(undefined);
    }).catch((reason) => { if (mounted) setError(errorMessage(reason)); });
    return () => { mounted = false; };
  }, [refreshToken]);
  const featured = state?.rows.find((row) => row.batchId === 1)?.batch ?? null;
  return (
    <div className="screen">
      <PageHeader eyebrow="01 / COMMAND OVERVIEW" title="Recall" >
        <span className="header-note">INTELLIGENT PRODUCT RECALL AUTHORIZATION<br /><span>READ-ONLY COMMAND SURFACE</span></span>
      </PageHeader>
      <section className="command-lede">
        <div><span className="eyebrow">SYSTEM PURPOSE</span><p>Recall verifies whether an exact registered product batch is covered by authoritative safety-recall evidence and exposes a deterministic onchain authorization signal.</p></div>
        <div className="system-state"><span className="status-dot good" /><span>LIVE</span><small>BRADBURY</small></div>
      </section>
      {error ? <ReadUnavailable message={error} /> : !state ? <LoadingState /> : (
        <>
          <section className="metrics-grid">
            <Metric label="REGISTERED BATCHES" value={formatCount(state.count)} detail="get_batch_count()" />
            <Metric label="ACTIVE RECALLS" value={formatCount(state.activeCount)} detail={state.activeCount === null ? "unavailable as a total · bounded registry scan" : "bounded public scan · actual recall_active"} />
            <Metric label="NETWORK" value={NETWORK_NAME} detail={`chain ${NETWORK_CHAIN_ID}`} />
            <Metric label="ASSESSMENT SIGNAL" value={featured ? formatCount(featured.assessmentCount) : "UNKNOWN"} detail="featured batch history" />
          </section>
          <section className="featured-layout">
            <div className="featured-incident">
              <div className="section-kicker"><span>FEATURED INCIDENT</span><span>BATCH / 0001</span></div>
              {featured ? <>
                <div className="incident-status"><StatusChip status={deriveBatchStatus(featured)} tone={statusTone(deriveBatchStatus(featured))} /><span className="incident-active">recall_active = {String(featured.recallActive)}</span></div>
                <h2>{featured.productName}</h2>
                <p className="incident-subtitle">{featured.manufacturer} · {featured.productModel}</p>
                <div className="incident-grid"><DataValue label="LOT / BATCH" value={featured.lotNumber} emphasis /><DataValue label="SKU / IDENTIFIER" value={featured.sku} /><DataValue label="VERDICT" value={featured.latestVerdict} /><DataValue label="BINDING" value={featured.latestBatchBinding} /></div>
                <button className="button button-dark" onClick={() => navigate("#/batch/1")}>INSPECT BATCH <span>↗</span></button>
              </> : <ReadUnavailable message="BATCH 1 / READ UNAVAILABLE" />}
            </div>
            <div className="authorization-panel">
              <span className="eyebrow">ENFORCEMENT SIGNAL</span>
              {featured ? <>
                <strong className={featured.recallActive ? "critical-text" : "safe-text"}>{featured.recallActive ? "DOWNSTREAM ACTION AUTHORIZED" : "DOWNSTREAM ACTION BLOCKED"}</strong>
                <p>The durable redemption consumer independently re-reads <code>recall_active(1)</code> immediately before a protected operation. This interface does not execute a refund or replacement.</p>
                <div className="authorization-rule" />
                <span className="muted">CONTRACT FIELD / AUTHORITATIVE</span>
              </> : <ReadUnavailable />}
            </div>
          </section>
          <section className="lower-grid">
            <div className="provenance-strip"><span className="eyebrow">CANONICAL CONTRACT</span><code>{CONTRACT_ADDRESS}</code><CopyButton value={CONTRACT_ADDRESS} /><a href={`${EXPLORER_URL}address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">EXPLORER ↗</a></div>
            <div className="provenance-strip"><span className="eyebrow">EVIDENCE POSTURE</span><span>Frozen source sets · consensus assessment · sticky activation</span><button className="text-button" onClick={() => navigate("#/about")}>VIEW ARCHITECTURE →</button></div>
          </section>
        </>
      )}
    </div>
  );
}

function RegistryScreen({ navigate, refreshToken }: ScreenProps) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadRegistry>>>();
  const [error, setError] = useState<string>();
  useEffect(() => { let mounted = true; void loadRegistry().then((value) => { if (mounted) { setResult(value); setError(undefined); } }).catch((reason) => { if (mounted) setError(errorMessage(reason)); }); return () => { mounted = false; }; }, [refreshToken]);
  return <div className="screen"><PageHeader eyebrow="02 / BATCH REGISTRY" title="Registered batches"><span className="header-note">PUBLIC READ / NO WALLET REQUIRED<br /><span>LATEST NONFINAL STATE</span></span></PageHeader>
    {error ? <ReadUnavailable message={error} /> : !result ? <LoadingState /> : <>
      <div className="registry-toolbar"><span>{formatCount(result.count)} registered records</span><span className="muted">{result.capped ? `Showing first ${LIMITS.registryScan}; scan capped for safety.` : "Bounded public read"}</span></div>
      <div className="registry-table" role="table" aria-label="Registered Recall batches"><div className="registry-head" role="row"><span>ID</span><span>PRODUCT / MANUFACTURER</span><span>LOT / BATCH</span><span>STATE</span><span>ASSESSMENTS</span><span /></div>
        {result.rows.map((row) => <RegistryRowView key={row.batchId} row={row} navigate={navigate} />)}
      </div>
      {result.rows.length === 0 && <ReadUnavailable message="NO REGISTERED BATCHES" />}
    </>}
  </div>;
}

function RegistryRowView({ row, navigate }: { row: RegistryRow; navigate: (path: string) => void }) {
  if (!row.batch) return <div className="registry-row unavailable"><span>#{String(row.batchId).padStart(4, "0")}</span><span className="muted">{row.error ?? "UNKNOWN / READ UNAVAILABLE"}</span><span /><span /><span /><button className="text-button" onClick={() => navigate(`#/batch/${row.batchId}`)}>INSPECT →</button></div>;
  const batch = row.batch as Batch;
  const status = deriveBatchStatus(batch);
  return <div className="registry-row" role="row"><span className="registry-id">#{String(batch.batchId).padStart(4, "0")}</span><span><strong>{batch.productName}</strong><small>{batch.manufacturer}</small></span><span><strong>{batch.lotNumber}</strong><small>{batch.batchCode}</small></span><span><StatusChip status={status} tone={statusTone(status)} /><small className="registry-boolean">recall_active: {String(batch.recallActive)}</small></span><span className="registry-count">{formatCount(batch.assessmentCount)}</span><button className="text-button" onClick={() => navigate(`#/batch/${batch.batchId}`)}>INSPECT →</button></div>;
}

function BatchDetailScreen({ navigate, batchId, performWrite, wallet, refreshToken }: ScreenProps & { batchId: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadBatchDetail>>>();
  const [error, setError] = useState<string>();
  useEffect(() => { let mounted = true; void loadBatchDetail(batchId).then((value) => { if (mounted) { setData(value); setError(undefined); } }).catch((reason) => { if (mounted) setError(errorMessage(reason)); }); return () => { mounted = false; }; }, [batchId, refreshToken]);
  if (error) return <div className="screen"><PageHeader eyebrow={`BATCH / ${batchId}`} title="Batch detail" /><ReadUnavailable message={error} /></div>;
  if (!data) return <div className="screen"><PageHeader eyebrow={`BATCH / ${batchId}`} title="Batch detail" /><LoadingState /></div>;
  if (!data.batch) return <div className="screen"><PageHeader eyebrow={`BATCH / ${batchId}`} title="Batch detail" /><ReadUnavailable message={`BATCH ${batchId} DOES NOT EXIST`} /></div>;
  const batch = data.batch;
  const latest = exactLatestAssessment(data.assessments, batch.assessmentCount);
  return <div className="screen detail-screen"><PageHeader eyebrow={`03 / BATCH DETAIL · ${String(batchId).padStart(4, "0")}`} title={batch.productName}><div className="header-actions"><button className="button button-quiet" onClick={() => navigate("#/registry")}>← REGISTRY</button><StatusChip status={deriveBatchStatus(batch)} tone={statusTone(deriveBatchStatus(batch))} /></div></PageHeader>
    <section className="detail-hero"><div><span className="eyebrow">EXACT REGISTERED IDENTITY</span><h2>{batch.manufacturer}</h2><p>{batch.productModel} · {batch.sku}</p></div><div className="detail-hero-state"><span className="eyebrow">RECALL ACTIVE</span><strong className={batch.recallActive ? "critical-text" : "safe-text"}>{String(batch.recallActive).toUpperCase()}</strong><small>CONTRACT FIELD / STICKY</small></div></section>
    <div className="detail-grid">
      <section className="detail-section identity-section"><SectionTitle index="A" title="Identity" note="FROZEN BATCH RECORD" /><div className="data-grid"><DataValue label="MANUFACTURER" value={batch.manufacturer} /><DataValue label="PRODUCT" value={batch.productName} /><DataValue label="MODEL" value={batch.productModel} /><DataValue label="SKU" value={batch.sku} /><DataValue label="LOT NUMBER" value={batch.lotNumber} emphasis /><DataValue label="BATCH CODE" value={batch.batchCode} /><DataValue label="MANUFACTURE DATE" value={formatDate(batch.manufactureDate)} /><DataValue label="PRODUCT IDENTIFIER" value={formatOptionalText(batch.productIdentifier)} /></div><div className="commitment-row"><span className="eyebrow">IDENTITY COMMITMENT</span><code>{batch.identityCommitment}</code><CopyButton value={batch.identityCommitment} /></div></section>
      <section className="detail-section recall-section"><SectionTitle index="B" title="Recall state" note="LIVE CONTRACT FIELDS" /><div className="state-list"><StateLine label="recall_active" value={String(batch.recallActive)} tone={batch.recallActive ? "critical" : "safe"} /><StateLine label="latest_verdict" value={batch.latestVerdict} /><StateLine label="latest_binding" value={batch.latestBatchBinding} /><StateLine label="active" value={String(batch.active)} /><StateLine label="sealed" value={String(batch.sealed)} /><StateLine label="assessment_started" value={String(batch.assessmentStarted)} /><StateLine label="assessment_count" value={formatCount(batch.assessmentCount)} /></div></section>
      <section className="detail-section governance-section"><SectionTitle index="C" title="Frozen governance" note="AUTHORITATIVE SOURCE SET" /><div className="governance-meta"><DataValue label="POLICY VERSION" value={formatCount(batch.policyVersion)} /><DataValue label="SOURCE SET VERSION" value={formatCount(batch.sourceSetVersion)} /></div><div className="long-field"><span className="eyebrow">RECALL POLICY</span><p>{batch.recallPolicy}</p></div><EvidenceLedger sources={batch.evidenceSources} sourceSetVersion={batch.sourceSetVersion} /></section>
      <section className="detail-section reasoning-section"><SectionTitle index="D" title="Latest reasoning" note={latest ? `ASSESSMENT #${latest.assessmentId}` : batch.assessmentCount > 0 ? "LATEST METADATA UNAVAILABLE" : "NO ASSESSMENT"} />{latest ? <><div className="assessment-meta"><DataValue label="VERDICT" value={latest.verdict} /><DataValue label="BINDING" value={latest.batchBinding} /><DataValue label="POLICY VERSION" value={formatCount(latest.policyVersion)} /><DataValue label="SOURCE SET VERSION" value={formatCount(latest.sourceSetVersion)} /></div><div className="long-field"><span className="eyebrow">EVIDENCE SUMMARY</span><p>{latest.evidenceSummary}</p></div><div className="long-field"><span className="eyebrow">REASONING</span><p>{latest.reasoning}</p></div><div className="commitment-row"><span className="eyebrow">EVIDENCE COMMITMENT</span><code>{latest.evidenceCommitment}</code><CopyButton value={latest.evidenceCommitment} /></div></> : batch.assessmentCount > 0 ? <><p className="callout watch">The exact latest assessment record is unavailable or outside the bounded global scan. Contract-level latest fields remain authoritative below; no assessment commitment is inferred.</p><div className="assessment-meta"><DataValue label="VERDICT" value={batch.latestVerdict} /><DataValue label="BINDING" value={batch.latestBatchBinding} /><DataValue label="POLICY VERSION" value={formatCount(batch.policyVersion)} /><DataValue label="SOURCE SET VERSION" value={formatCount(batch.sourceSetVersion)} /></div><div className="long-field"><span className="eyebrow">EVIDENCE SUMMARY / CONTRACT FIELD</span><p>{batch.latestEvidenceSummary}</p></div><div className="long-field"><span className="eyebrow">REASONING / CONTRACT FIELD</span><p>{batch.latestReasoning}</p></div></> : <ReadUnavailable message="NO ASSESSMENTS RECORDED" />}</section>
      <section className="detail-section timeline-section"><SectionTitle index="E" title="Assessment timeline" note="GLOBAL HISTORY FILTERED BY BATCH ID" />{(data.assessmentScanCapped || data.assessmentReadFailures > 0) && <p className="callout watch">Partial timeline: {data.assessmentReadFailures > 0 ? `${data.assessmentReadFailures} assessment read${data.assessmentReadFailures === 1 ? "" : "s"} failed. ` : ""}{data.assessmentScanCapped ? `Only the newest ${LIMITS.assessmentScan} global records were scanned.` : "Some records are unavailable."} Older or unreadable records are not inferred.</p>}{data.assessments.length ? <div className="timeline">{data.assessments.map((assessment) => <AssessmentTimelineItem key={assessment.assessmentId} assessment={assessment} />)}</div> : <ReadUnavailable message="NO MATCHING ASSESSMENTS" />}</section>
      <section className="detail-section enforcement-section"><SectionTitle index="F" title="Enforcement state" note="DURABLE CONSUMER SEPARATION" /><div className={`enforcement-message ${batch.recallActive ? "critical" : "safe"}`}><span className="eyebrow">{batch.recallActive ? "AUTHORIZED SIGNAL" : "BLOCKED SIGNAL"}</span><strong>{batch.recallActive ? "DOWNSTREAM ACTION AUTHORIZED" : "DOWNSTREAM ACTION BLOCKED"}</strong><p>The durable <code>recall-redeem</code> consumer performs an independent fresh read immediately before a protected refund/replacement workflow. This browser interface does not execute the downstream operation.</p></div></section>
    </div>
    {batch.sealed && <AssessmentForm batch={batch} wallet={wallet} performWrite={performWrite} onComplete={() => window.location.reload()} />}
  </div>;
}

function SectionTitle({ index, title, note }: { index: string; title: string; note: string }) { return <div className="section-title"><span className="section-index">{index}</span><h3>{title}</h3><span className="section-note">{note}</span></div>; }
function DataValue({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) { return <div className={`data-value ${emphasis ? "emphasis" : ""}`}><span className="eyebrow">{label}</span><strong>{value || "NOT PROVIDED"}</strong></div>; }
function StateLine({ label, value, tone }: { label: string; value: string; tone?: "critical" | "safe" }) { return <div className="state-line"><code>{label}</code><strong className={tone ? `${tone}-text` : ""}>{value}</strong></div>; }

function EvidenceLedger({ sources, sourceSetVersion }: { sources: string[]; sourceSetVersion: number }) { return <div className="evidence-ledger"><div className="ledger-head"><span className="eyebrow">EVIDENCE PROVENANCE LEDGER</span><span className="muted">SOURCE SET V{sourceSetVersion}</span></div>{sources.map((source, index) => <div className="ledger-row" key={source}><span className="ledger-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{hostnameFromUrl(source)}</strong><small>{source}</small></div><a href={source} target="_blank" rel="noreferrer">OPEN ↗</a></div>)}</div>; }
function AssessmentTimelineItem({ assessment }: { assessment: Assessment }) { return <div className="timeline-item"><span className="timeline-dot" /><div><div className="timeline-top"><strong>Assessment #{assessment.assessmentId}</strong><span className="muted">SEQUENCE {assessment.sequenceNumber}</span></div><p>{assessment.title}</p><div className="timeline-tags"><StatusChip status={assessment.verdict} tone={assessment.verdict === "AFFECTED" ? "critical" : assessment.verdict === "NOT_AFFECTED" ? "safe" : "watch"} /><span>{assessment.batchBinding}</span><span>REVIEWER {shortHash(assessment.reviewer)}</span></div></div></div>; }

function AssessmentForm({ batch, wallet, performWrite, onComplete }: { batch: Batch; wallet: WalletState; performWrite: PerformWrite; onComplete: () => void }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(undefined); if (!title.trim() || !notes.trim()) { setError("Title and notes are required by the contract."); return; } if (!reviewing) { setReviewing(true); return; } try { const sourceValidation = validateEvidenceSources(batch.evidenceSources); if (sourceValidation.error || !wallet.address) { setError(sourceValidation.error ?? "Connect a valid reviewer wallet on Bradbury."); return; } const beforeBatch = await readBatch(batch.batchId); if (!beforeBatch) { setError("The batch state is unavailable; assessment was not submitted."); return; } const beforeGlobalCount = await readAssessmentCount(); const expected: AssessmentConfirmation = { batchId: batch.batchId, title: title.trim(), notes: notes.trim(), reviewer: wallet.address, evidenceSources: sourceValidation.canonical, priorBatchAssessmentCount: beforeBatch.assessmentCount }; await performWrite("assess_batch", assessmentArgs(batch.batchId, expected.title, expected.notes, sourceValidation.canonical), async () => { const afterGlobalCount = await readAssessmentCount(); const ids = boundedNewRecordIds(beforeGlobalCount, afterGlobalCount); const candidates = await Promise.all(ids.map((assessmentId) => readAssessment(assessmentId).catch(() => null))); return candidates.some((assessment): assessment is Assessment => assessment !== null && assessmentMatchesSubmission(assessment, expected)); }); onComplete(); } catch (reason) { setError(errorMessage(reason)); } };
  return <section className="assessment-form detail-section"><SectionTitle index="G" title="Run assessment" note="PERMISSIONLESS / FROZEN SOURCES REQUIRED" /><p className="form-intro">The contract independently evaluates the sealed identity, policy, and complete frozen evidence set. Title and notes remain audit metadata only.</p><form onSubmit={(event) => void submit(event)}>{!reviewing ? <><FormField label="ASSESSMENT TITLE" value={title} onChange={setTitle} maxLength={LIMITS.title} placeholder="e.g. Official regulator evidence review" /><FormField label="CLAIMED RISK / NOTES" value={notes} onChange={setNotes} maxLength={LIMITS.notes} multiline placeholder="Explain the assessment context. The contract does not use this prose as adjudication evidence." /><FrozenSources sources={batch.evidenceSources} /><button className="button button-dark" type="submit">REVIEW ASSESSMENT →</button></> : <ReviewPanel title="Assessment review" items={[`Batch #${batch.batchId} · ${batch.productName}`, `Frozen sources: ${batch.evidenceSources.length}`, `Title: ${title}`, "Notes are audit metadata; contract evidence is fetched independently."]} onBack={() => setReviewing(false)} submitLabel="SIGN ASSESSMENT" />}</form>{error && <p className="form-error" role="alert">{error}</p>}{wallet.status !== "connected" && <p className="form-note">Assessment is permissionless on the contract, but browser writes require an injected wallet on Bradbury.</p>}</section>;
}

function FrozenSources({ sources }: { sources: string[] }) { return <div className="frozen-sources"><div className="field-label"><span>COMPLETE FROZEN EVIDENCE SET</span><em>{sources.length} / {LIMITS.sourceCount}</em></div>{sources.map((source, index) => <div className="frozen-source" key={source}><span>{String(index + 1).padStart(2, "0")}</span><code>{source}</code></div>)}</div>; }
function FormField({ label, value, onChange, maxLength, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; maxLength: number; placeholder: string; multiline?: boolean }) { return <label className="form-field"><span className="field-label"><span>{label}</span><em>{value.length} / {maxLength}</em></span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} rows={5} /> : <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} />}</label>; }

function RegistrySummary({ rows, selectedId, onSelect }: { rows: RegistryRow[]; selectedId: number; onSelect: (id: number) => void }) { return <label className="select-field"><span className="field-label"><span>SELECT BATCH</span><em>OWNER CONTROLS</em></span><select value={selectedId} onChange={(event) => onSelect(Number(event.target.value))}>{rows.map((row) => { const batch = row.batch; return batch ? <option value={row.batchId} key={row.batchId}>#{String(row.batchId).padStart(4, "0")} · {batch.productName}</option> : null; })}</select></label>; }

function OwnerControlsScreen({ wallet, performWrite, refreshToken, navigate }: ScreenProps) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadRegistry>>>();
  const [selectedId, setSelectedId] = useState(1);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [policy, setPolicy] = useState("");
  const [sources, setSources] = useState("");
  const [confirmSeal, setConfirmSeal] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { let mounted = true; void loadRegistry().then((value) => { if (!mounted) return; setResult(value); const first = value.rows.find((row) => row.batch); if (first?.batch) { setSelectedId(first.batch.batchId); setBatch(first.batch); setPolicy(first.batch.recallPolicy); setSources(first.batch.evidenceSources.join("\n")); } }).catch((reason) => { if (mounted) setError(errorMessage(reason)); }); return () => { mounted = false; }; }, [refreshToken]);
  useEffect(() => { if (!result) return; const row = result.rows.find((item) => item.batchId === selectedId); if (row?.batch) { setBatch(row.batch); setPolicy(row.batch.recallPolicy); setSources(row.batch.evidenceSources.join("\n")); setMessage(undefined); setConfirmSeal(false); } }, [result, selectedId]);
  const isOwner = Boolean(batch && wallet.address && batch.owner.toLowerCase() === wallet.address.toLowerCase());
  const run = async (name: string, args: unknown[], check: () => Promise<boolean>, success: string) => { setError(undefined); setMessage(undefined); try { await performWrite(name, args, check); setMessage(success); const next = await readBatch(selectedId); if (next) { setBatch(next); setPolicy(next.recallPolicy); setSources(next.evidenceSources.join("\n")); } } catch (reason) { setError(errorMessage(reason)); } };
  const savePolicy = () => { if (!batch) return; const validation = validateRecallPolicy(policy); if (validation) { setError(validation); return; } const submittedPolicy = policy; const previousVersion = batch.policyVersion; void run("update_recall_policy", policyArgs(batch.batchId, submittedPolicy), async () => { const next = await readBatch(batch.batchId); return next !== null && policyUpdateMatches(next, previousVersion, submittedPolicy); }, "Policy version and value confirmed on contract."); };
  const saveSources = () => { if (!batch) return; const validation = validateEvidenceSources(sources.split("\n")); if (validation.error) { setError(validation.error); return; } const submittedSources = validation.canonical; const previousVersion = batch.sourceSetVersion; void run("update_evidence_sources", sourcesArgs(batch.batchId, submittedSources), async () => { const next = await readBatch(batch.batchId); return next !== null && sourcesUpdateMatches(next, previousVersion, submittedSources); }, "Source-set version and values confirmed on contract."); };
  if (error) return <div className="screen"><PageHeader eyebrow="05 / OWNER CONTROLS" title="Governance" /><ReadUnavailable message={error} /></div>;
  if (!result) return <div className="screen"><PageHeader eyebrow="05 / OWNER CONTROLS" title="Governance" /><LoadingState /></div>;
  return <div className="screen"><PageHeader eyebrow="05 / OWNER CONTROLS" title="Governance"><span className="header-note">INJECTED WALLET REQUIRED FOR WRITES<br /><span>OWNER-GATED CONTRACT METHODS</span></span></PageHeader><div className="owner-layout"><div className="owner-selector"><RegistrySummary rows={result.rows} selectedId={selectedId} onSelect={setSelectedId} />{batch ? <><div className="owner-identity"><span className="eyebrow">RECORDED OWNER</span><code>{batch.owner}</code><small>{isOwner ? "CONNECTED ACCOUNT MATCH" : "CONNECTED ACCOUNT IS NOT OWNER"}</small></div><button className="text-button" onClick={() => navigate(`#/batch/${batch.batchId}`)}>INSPECT FULL BATCH →</button></> : <ReadUnavailable message="NO BATCH SELECTED" />}</div><div className="owner-actions">{batch && !isOwner && <div className="callout watch"><strong>READ-ONLY CONTROL SURFACE</strong><p>These mutations are owner-gated by the contract. Connect the recorded owner account on Bradbury to enable them; read-only state remains visible.</p></div>}{batch && isOwner ? <>{!batch.sealed && <><div className="control-block"><div><span className="eyebrow">POLICY EDITOR</span><h3>Update recall policy</h3></div><textarea value={policy} maxLength={LIMITS.policy} onChange={(event) => setPolicy(event.target.value)} /><div className="control-footer"><span className="muted">{policy.length} / {LIMITS.policy}</span><button className="button button-quiet" onClick={savePolicy}>SAVE POLICY</button></div></div><div className="control-block"><div><span className="eyebrow">SOURCE SET EDITOR</span><h3>Update frozen evidence sources</h3></div><textarea value={sources} onChange={(event) => setSources(event.target.value)} placeholder="One HTTP(S) URL per line" /><div className="control-footer"><span className="muted">{sources.split("\n").map((value) => value.trim()).filter(Boolean).length} / {LIMITS.sourceCount} URLs</span><button className="button button-quiet" onClick={saveSources}>SAVE SOURCES</button></div></div><div className="critical-control"><div><span className="eyebrow">IRREVERSIBLE CONTROL</span><h3>Seal policy & evidence set</h3><p>After sealing, policy and sources cannot be changed. Assessment becomes available against this exact frozen set.</p></div>{!confirmSeal ? <button className="button button-dark" onClick={() => setConfirmSeal(true)}>REVIEW SEALING →</button> : <ReviewPanel title="Confirm irreversible seal" items={[`Batch #${batch.batchId} · ${batch.productName}`, `Policy version ${batch.policyVersion}`, `Source set version ${batch.sourceSetVersion}`, "I understand the policy and evidence set will be frozen."]} onBack={() => setConfirmSeal(false)} submitLabel="CONFIRM & SEAL" onSubmit={() => { void run("seal_batch", [BigInt(batch.batchId)], async () => { const next = await readBatch(batch.batchId); return next?.sealed === true; }, "Sealed state confirmed on contract."); }} />}</div></>}{<div className="control-block active-control"><div><span className="eyebrow">ADMINISTRATIVE FLAG</span><h3>Set batch active</h3><p>This record flag does not clear sticky <code>recall_active</code>.</p></div><button className="button button-quiet" onClick={() => void run("set_batch_active", activeArgs(batch.batchId, !batch.active), async () => { const next = await readBatch(batch.batchId); return next?.active === !batch.active; }, `Active state confirmed as ${!batch.active}.`)}>SET ACTIVE: {String(!batch.active).toUpperCase()}</button></div>}</> : batch ? <div className="callout"><strong>CONNECTED WALLET REQUIRED</strong><p>Writes stay disabled until an injected EIP-1193 wallet is connected on Bradbury.</p></div> : null}{message && <p className="form-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}</div></div></div>;
}

function RegisterScreen({ performWrite, wallet, navigate }: ScreenProps) {
  const [values, setValues] = useState<RegisterFormValues>({ manufacturer: "", productName: "", productModel: "", sku: "", lotNumber: "", batchCode: "", manufactureDate: "", productIdentifier: "", recallPolicy: "", evidenceSources: [""] });
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const update = (key: keyof RegisterFormValues, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const validate = (): string | null => { const required: Array<[keyof RegisterFormValues, string]> = [["manufacturer", "Manufacturer"], ["productName", "Product name"], ["productModel", "Product model"], ["sku", "SKU"], ["lotNumber", "Lot number"], ["batchCode", "Batch code"]]; for (const [key, label] of required) if (!String(values[key]).trim()) return `${label} is required.`; const policyError = validateRecallPolicy(values.recallPolicy); if (policyError) return policyError; return validateEvidenceSources(values.evidenceSources).error; };
  const submit = async (event: FormEvent) => { event.preventDefault(); const validation = validate(); if (validation) { setError(validation); return; } setError(undefined); if (!reviewing) { setReviewing(true); return; } try { const sourceValidation = validateEvidenceSources(values.evidenceSources); if (sourceValidation.error || !wallet.address) { setError(sourceValidation.error ?? "Connect the wallet that will own this batch."); return; } const before = await readBatchCount(); const expected: RegistrationConfirmation = { owner: wallet.address, manufacturer: values.manufacturer, productName: values.productName, productModel: values.productModel, sku: values.sku, lotNumber: values.lotNumber, batchCode: values.batchCode, manufactureDate: values.manufactureDate, productIdentifier: values.productIdentifier, recallPolicy: values.recallPolicy, evidenceSources: sourceValidation.canonical }; await performWrite("register_batch", registerArgs({ ...values, evidenceSources: sourceValidation.canonical }), async () => { const after = await readBatchCount(); const ids = boundedNewRecordIds(before, after); const candidates = await Promise.all(ids.map((batchId) => readBatch(batchId).catch(() => null))); return candidates.some((batch): batch is Batch => batch !== null && batchMatchesRegistration(batch, expected)); }); setReviewing(false); navigate("#/registry"); } catch (reason) { setError(errorMessage(reason)); } };
  return <div className="screen"><PageHeader eyebrow="04 / REGISTER BATCH" title="Create a batch record"><span className="header-note">OWNER WRITE / WALLET REQUIRED<br /><span>IDENTITY IS IMMUTABLE AFTER REGISTRATION</span></span></PageHeader><div className="form-layout"><form className="record-form" onSubmit={(event) => void submit(event)}>{!reviewing ? <><div className="form-group"><div className="form-group-title"><span className="section-index">A</span><div><span className="eyebrow">PRODUCT IDENTITY</span><h3>Register exact product batch</h3></div></div><div className="two-col"><FormField label="MANUFACTURER" value={values.manufacturer} onChange={(value) => update("manufacturer", value)} maxLength={LIMITS.identity} placeholder="Legal manufacturer name" /><FormField label="PRODUCT NAME" value={values.productName} onChange={(value) => update("productName", value)} maxLength={LIMITS.identity} placeholder="Commercial product name" /><FormField label="PRODUCT MODEL" value={values.productModel} onChange={(value) => update("productModel", value)} maxLength={LIMITS.identity} placeholder="Model / presentation" /><FormField label="SKU / NDC" value={values.sku} onChange={(value) => update("sku", value)} maxLength={LIMITS.identity} placeholder="SKU or product code" /><FormField label="LOT NUMBER" value={values.lotNumber} onChange={(value) => update("lotNumber", value)} maxLength={LIMITS.identity} placeholder="Exact lot number" /><FormField label="BATCH CODE" value={values.batchCode} onChange={(value) => update("batchCode", value)} maxLength={LIMITS.identity} placeholder="Exact batch code" /><FormField label="MANUFACTURE DATE / CODE" value={values.manufactureDate} onChange={(value) => update("manufactureDate", value)} maxLength={LIMITS.identity} placeholder="Optional" /><FormField label="PRODUCT IDENTIFIER" value={values.productIdentifier} onChange={(value) => update("productIdentifier", value)} maxLength={LIMITS.identity} placeholder="Optional identifier" /></div></div><div className="form-group"><div className="form-group-title"><span className="section-index">B</span><div><span className="eyebrow">RECALL POLICY</span><h3>Define the adjudication boundary</h3></div></div><FormField label="RECALL POLICY" value={values.recallPolicy} onChange={(value) => update("recallPolicy", value)} maxLength={LIMITS.policy} placeholder="State the exact evidence criteria for this product batch." multiline /></div><div className="form-group"><div className="form-group-title"><span className="section-index">C</span><div><span className="eyebrow">EVIDENCE SOURCES</span><h3>Declare authoritative endpoints</h3></div></div><p className="form-intro">Once sealed, these exact URLs become the authoritative source set. Use stable regulator or manufacturer endpoints; the contract fetches them during consensus.</p>{values.evidenceSources.map((source, index) => <div className="source-editor-row" key={`${index}-${source}`}><span>{String(index + 1).padStart(2, "0")}</span><input value={source} maxLength={2048} onChange={(event) => setValues((current) => ({ ...current, evidenceSources: current.evidenceSources.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder="https://..." />{values.evidenceSources.length > 1 && <button className="icon-button" type="button" onClick={() => setValues((current) => ({ ...current, evidenceSources: current.evidenceSources.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remove source ${index + 1}`}>×</button>}</div>)}{values.evidenceSources.length < LIMITS.sourceCount && <button className="text-button" type="button" onClick={() => setValues((current) => ({ ...current, evidenceSources: [...current.evidenceSources, ""] }))}>+ ADD SOURCE</button>}</div><button className="button button-dark" type="submit">REVIEW REGISTRATION →</button></> : <ReviewPanel title="Registration review" items={[`${values.manufacturer} / ${values.productName}`, `Batch identity: ${values.lotNumber} · ${values.batchCode}`, `Policy characters: ${values.recallPolicy.length} / ${LIMITS.policy}`, `Authoritative sources: ${values.evidenceSources.filter(Boolean).length}`, "Identity cannot be edited after registration. Policy and sources remain editable only until sealing."]} onBack={() => setReviewing(false)} submitLabel="SIGN REGISTER TRANSACTION" />}</form><aside className="form-aside"><div className="aside-rule" /><span className="eyebrow">WRITE TRUTH</span><p>Signing submits a GenLayer transaction. The interface will not call the record complete until the contract state confirms the new batch.</p><div className="aside-rule" /><span className="eyebrow">CONNECTED ACCOUNT</span><code>{wallet.address ?? "NOT CONNECTED"}</code><button className="text-button" type="button" onClick={() => navigate("#/owner")}>OWNER CONTROLS →</button></aside></div>{error && <p className="form-error global-form-error" role="alert">{error}</p>}</div>;
}

function ReviewPanel({ title, items, onBack, submitLabel, onSubmit }: { title: string; items: string[]; onBack: () => void; submitLabel: string; onSubmit?: () => void }) { return <div className="review-panel"><span className="eyebrow">FINAL REVIEW</span><h3>{title}</h3><div className="review-items">{items.map((item) => <div key={item}><span>—</span><p>{item}</p></div>)}</div><div className="review-actions"><button className="button button-quiet" type="button" onClick={onBack}>← EDIT</button><button className="button button-dark" type={onSubmit ? "button" : "submit"} onClick={onSubmit}>{submitLabel} ↗</button></div></div>; }

function AssessmentHistoryScreen({ navigate, refreshToken }: ScreenProps) {
  const [state, setState] = useState<Awaited<ReturnType<typeof loadAssessmentHistory>>>();
  const [error, setError] = useState<string>();
  useEffect(() => { let mounted = true; void loadAssessmentHistory().then((value) => { if (mounted) { setState(value); setError(undefined); } }).catch((reason) => { if (mounted) setError(errorMessage(reason)); }); return () => { mounted = false; }; }, [refreshToken]);
  return <div className="screen"><PageHeader eyebrow="03 / ASSESSMENT HISTORY" title="Consensus record"><span className="header-note">GLOBAL ASSESSMENT INDEX<br /><span>REVIEWER PROVENANCE / COMMITMENTS</span></span></PageHeader>{error ? <ReadUnavailable message={error} /> : !state ? <LoadingState /> : <><div className="registry-toolbar"><span>{formatCount(state.count)} total assessments</span><span className="muted">{state.capped ? `Showing newest ${LIMITS.assessmentScan} addressable records.` : "Latest-nonfinal public reads"}</span></div>{(state.capped || state.failedReads > 0) && <p className="callout watch">Partial history: {state.failedReads > 0 ? `${state.failedReads} assessment read${state.failedReads === 1 ? "" : "s"} failed. ` : ""}{state.capped ? `Only the newest ${LIMITS.assessmentScan} global records were scanned.` : "Some records are unavailable."} The total count is authoritative; missing records are not inferred.</p>}{state.assessments.length ? <div className="history-list">{state.assessments.map((assessment) => <button className="history-row" key={assessment.assessmentId} onClick={() => navigate(`#/batch/${assessment.batchId}`)}><span className="registry-id">#{String(assessment.assessmentId).padStart(4, "0")}</span><span><strong>{assessment.title}</strong><small>Batch #{assessment.batchId} · sequence {assessment.sequenceNumber}</small></span><StatusChip status={assessment.verdict} tone={assessment.verdict === "AFFECTED" ? "critical" : assessment.verdict === "NOT_AFFECTED" ? "safe" : "watch"} /><span className="muted">{shortHash(assessment.evidenceCommitment)}</span><span>→</span></button>)}</div> : <ReadUnavailable message="NO ASSESSMENTS RECORDED" />}</>}</div>;
}

function AboutScreen(_: ScreenProps) { return <div className="screen"><PageHeader eyebrow="06 / ABOUT & ARCHITECTURE" title="Evidence to authorization"><span className="header-note">RECALL / SYSTEM NOTES<br /><span>NO BROWSER PAYOUT EXECUTION</span></span></PageHeader><section className="about-lede"><span className="eyebrow">THE PRODUCT QUESTION</span><h2>Is this exact product batch covered by a real safety recall?</h2><p>Recall turns a sealed identity, policy, and source set into an auditable consensus assessment and a deterministic authorization signal.</p></section><section className="architecture-flow" aria-label="Recall enforcement architecture">{["AUTHORITATIVE SOURCE SET", "RECALL INTELLIGENT CONTRACT", "GENLAYER CONSENSUS", "AFFECTED + BOUND", "recall_active(batch_id)", "DURABLE REDEMPTION GATE", "DOWNSTREAM REFUND / REPLACEMENT SYSTEM"].map((item, index) => <div className="flow-step" key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong>{index < 6 && <i>↓</i>}</div>)}</section><div className="about-grid"><div className="about-note"><span className="eyebrow">PUBLIC READS</span><h3>Wallet-free by default</h3><p>Batch registry, detail, evidence provenance, assessment history, and the live authorization field read directly from Bradbury using the official <code>genlayer-js</code> client and latest-nonfinal state.</p></div><div className="about-note"><span className="eyebrow">WRITES</span><h3>Explicitly wallet-gated</h3><p>Writes use an injected EIP-1193 provider only after account and chain verification. The browser uses direct provider requests and no SDK-owned connection flow; it handles account and chain events itself.</p></div><div className="about-note"><span className="eyebrow">TRANSACTION TRUTH</span><h3>Accepted is not recorded</h3><p>After submission, the app shows consensus progress, then polls expected contract state. “RECORDED” appears only after the authoritative state matches; unresolved or pending states remain explicit.</p></div><div className="about-note"><span className="eyebrow">DOWNSTREAM SEPARATION</span><h3>The browser is not the gate</h3><p>The repository’s <code>recall-redeem</code> command is the durable enforcement demonstration. It performs its own fresh read and fails closed before invoking a protected downstream command.</p></div></div></div>; }

function TransactionTray({ progress, onDismiss }: { progress: TransactionProgress; onDismiss: () => void }) { const final = ["RECORDED", "CONSENSUS_UNRESOLVED", "STATE_CONFIRMATION_PENDING", "WALLET_REJECTED", "FAILED"].includes(progress.stage); return <div className={`transaction-tray ${progress.stage === "RECORDED" ? "success" : final ? "attention" : ""}`} role="status" aria-live="polite"><div><span className="eyebrow">TRANSACTION TRUTH</span><strong>{STAGE_LABELS[progress.stage]}</strong>{progress.detail && <p>{progress.detail}</p>}{progress.hash && <code>{progress.hash}</code>}</div>{final && <button className="icon-button" onClick={onDismiss} aria-label="Dismiss transaction status">×</button>}</div>; }

export default App;
