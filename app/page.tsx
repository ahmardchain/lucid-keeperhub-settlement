import {
  ArrowRight,
  Braces,
  Check,
  ExternalLink,
  GitBranch,
  LockKeyhole,
  Radio,
  RefreshCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { EvidenceLedger } from "@/components/evidence-ledger";
import { SettlementFlow } from "@/components/settlement-flow";

const githubUrl = "https://github.com/ahmardchain/lucid-keeperhub-settlement";

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Settlement Recovery home">
          <span className="brand-mark" aria-hidden="true"><span /><span /></span>
          <span><strong>Settlement Recovery</strong><small>Lucid × KeeperHub</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#route">Money path</a>
          <a href="#evidence">Evidence</a>
          <a href="#recovery">Recovery</a>
          <a className="header-github" href={githubUrl} target="_blank" rel="noreferrer">
            <GitBranch aria-hidden="true" /><span>Source</span>
          </a>
        </nav>
      </header>

      <div id="top" className="hero-shell">
        <section className="hero-copy" aria-labelledby="hero-title">
          <div className="hero-kicker">
            <span><Radio aria-hidden="true" /> AGENT ECONOMY 2026</span>
            <span>BASE SEPOLIA</span>
          </div>
          <h1 id="hero-title">Pay after proof.<span>Refund after failure.</span></h1>
          <p className="hero-summary">
            A post-fulfillment settlement layer for paid Lucid tasks. x402 sends
            USDC into a KeeperHub-controlled wallet; deterministic verification
            decides the only transfer that can follow.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#route">
              Inspect the route <ArrowRight aria-hidden="true" />
            </a>
            <a className="text-action" href={githubUrl} target="_blank" rel="noreferrer">
              Read the implementation <ExternalLink aria-hidden="true" />
            </a>
          </div>
          <dl className="hero-facts">
            <div><dt>Payment rail</dt><dd>x402 exact / USDC</dd></div>
            <div><dt>Execution rail</dt><dd>KeeperHub direct transfer</dd></div>
            <div><dt>Replay boundary</dt><dd>1 operation → 1 transfer</dd></div>
          </dl>
        </section>

        <aside className="hero-proof" aria-label="Core settlement invariant">
          <div className="proof-grid" aria-hidden="true" />
          <div className="proof-topline">
            <span className="mono-label">SYSTEM INVARIANT / 001</span>
            <span className="proof-status"><Check aria-hidden="true" /> TESTED</span>
          </div>
          <div className="proof-lock"><LockKeyhole aria-hidden="true" /></div>
          <p className="proof-equation">
            <span>terminal task</span><b>+</b><span>valid verdict</span><b>+</b><span>verified receipt</span>
          </p>
          <div className="proof-result"><span>USDC may move</span><ShieldCheck aria-hidden="true" /></div>
          <p className="proof-note">
            The wallet is not called escrow. It is a controlled settlement
            account, and KeeperHub is the sole post-task spender.
          </p>
        </aside>
      </div>

      <section className="problem-strip" aria-labelledby="problem-title">
        <div className="section-index">00 / THE GAP</div>
        <div>
          <h2 id="problem-title">Payment success is not fulfillment success.</h2>
          <p>
            Lucid can settle an async task after reservation and before the work
            finishes. Sending that payment directly to a worker turns a failed
            task into an unrecoverable commercial outcome. This integration
            changes the destination and makes the terminal state executable.
          </p>
        </div>
        <div className="gap-contrast" aria-label="Before and after comparison">
          <div><span>DIRECT-TO-WORKER</span><strong>Paid, then failed</strong><small>No automatic recovery</small></div>
          <ArrowRight aria-hidden="true" />
          <div><span>SETTLEMENT RECOVERY</span><strong>Held, verified, resolved</strong><small>Payout or payer-bound refund</small></div>
        </div>
      </section>

      <section id="route" className="route-section">
        <div className="section-heading">
          <div className="section-index">01 / MONEY PATH</div>
          <div>
            <h2>One terminal decision. Two safe outcomes.</h2>
            <p>
              Switch the trace to see what changes—and what remains fixed.
              KeeperHub simulates and executes both branches through the same
              receipt-gated adapter.
            </p>
          </div>
        </div>
        <SettlementFlow />
      </section>

      <section className="invariants-section" aria-labelledby="invariants-title">
        <div className="section-index">02 / TRUST BOUNDARIES</div>
        <div className="invariants-intro">
          <h2 id="invariants-title">Small surface. Hard edges.</h2>
          <p>
            The integration accepts less so it can prove more: one network, one
            asset, one deterministic verifier, and one post-task execution path.
          </p>
        </div>
        <div className="invariant-list">
          <article><span>01</span><ShieldCheck aria-hidden="true" /><h3>Payer-bound refunds</h3><p>The refund address is derived from the verified x402 response—not task input.</p></article>
          <article><span>02</span><Braces aria-hidden="true" /><h3>Deterministic verdicts</h3><p>Schema, deadline, receipt status, and counts decide. No model participates in payout.</p></article>
          <article><span>03</span><LockKeyhole aria-hidden="true" /><h3>Immutable direction</h3><p>The first terminal decision is durable. A replay cannot flip refund into payout.</p></article>
          <article><span>04</span><RefreshCcw aria-hidden="true" /><h3>Crash-safe replay</h3><p>The operation-derived KeeperHub key names the work, so an interrupted attempt resumes.</p></article>
        </div>
      </section>

      <section id="evidence" className="evidence-section" aria-labelledby="evidence-title">
        <div className="section-heading evidence-heading">
          <div className="section-index">03 / PUBLIC EVIDENCE</div>
          <div>
            <h2 id="evidence-title">Claims become a receipt ledger.</h2>
            <p>
              Each row joins four namespaces: operation, Lucid task, KeeperHub
              execution, and onchain transaction. The ledger refuses to display
              fixture hashes as live evidence.
            </p>
          </div>
        </div>
        <EvidenceLedger />
      </section>

      <section id="recovery" className="recovery-section" aria-labelledby="recovery-title">
        <div className="section-heading">
          <div className="section-index">04 / FAILURE RECOVERY</div>
          <div>
            <h2 id="recovery-title">The failure demo is the product demo.</h2>
            <p>
              Happy-path payout is expected. The differentiator is refusing bad
              state and recovering uncertain state without another transfer.
            </p>
          </div>
        </div>
        <div className="recovery-matrix" role="region" aria-label="Recovery behavior table" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Injected condition</th><th scope="col">Deterministic response</th><th scope="col">Money outcome</th><th scope="col">Proof</th></tr></thead>
            <tbody>
              <tr><th scope="row"><TriangleAlert aria-hidden="true" /> Receipt missing</th><td><code>RECEIPTS_NOT_CONFIRMED</code></td><td><span className="outcome-refund">Refund payer</span></td><td>Verified KeeperHub receipt</td></tr>
              <tr><th scope="row"><TriangleAlert aria-hidden="true" /> Deadline exceeded</th><td><code>DEADLINE_EXCEEDED</code></td><td><span className="outcome-refund">Refund payer</span></td><td>Immutable terminal decision</td></tr>
              <tr><th scope="row"><RefreshCcw aria-hidden="true" /> Duplicate settle</th><td>Return stored operation</td><td><span className="outcome-neutral">No second transfer</span></td><td>Stable idempotency key</td></tr>
              <tr><th scope="row"><RefreshCcw aria-hidden="true" /> Crash after broadcast</th><td>Poll saved execution ID</td><td><span className="outcome-neutral">Resume, never resend</span></td><td>SQLite + KeeperHub status</td></tr>
              <tr><th scope="row"><TriangleAlert aria-hidden="true" /> Unverified completion</th><td>Fail closed</td><td><span className="outcome-blocked">Block finality claim</span></td><td><code>receipts[].verified</code></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="implementation-section" aria-labelledby="implementation-title">
        <div className="implementation-copy">
          <div className="section-index">05 / ADAPTER CONTRACT</div>
          <h2 id="implementation-title">Safe first-write is executable code.</h2>
          <p>
            The adapter sends human-readable USDC to KeeperHub, keeps the body
            stable, and refuses to call a self-reported hash final.
          </p>
          <a href={`${githubUrl}/tree/main/src/keeperhub`} target="_blank" rel="noreferrer">Inspect the adapter <ArrowRight aria-hidden="true" /></a>
        </div>
        <div className="code-window" aria-label="KeeperHub settlement sequence code example">
          <div className="code-titlebar"><span>settle.ts</span><span>POST-FULFILLMENT ONLY</span></div>
          <pre><code>{`const verdict = verifyLucidTask(task)
const key = stableKey(operationId, verdict)

await keeperhub.simulate(transfer)
const execution = await keeperhub.execute({
  ...transfer,
  idempotencyKey: key,
})

const receipt = await keeperhub.poll(execution.id)
assert(receipt.verified && receipt.status === "success")`}</code></pre>
        </div>
      </section>

      <section className="final-cta">
        <div><span className="mono-label">BUILT FOR KEEPERHUB AGENT ECONOMY</span><h2>The worker gets paid when the work is proven.</h2><p>The buyer gets made whole when it is not.</p></div>
        <a className="primary-action dark-action" href={githubUrl} target="_blank" rel="noreferrer"><GitBranch aria-hidden="true" /> Review the source</a>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span><strong>Settlement Recovery</strong><small>Lucid × KeeperHub</small></span></div>
        <p>Base Sepolia · Exact x402 · USDC · Deterministic verification</p>
        <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink aria-hidden="true" /></a>
      </footer>
    </main>
  );
}
