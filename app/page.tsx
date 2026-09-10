import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PublicationMotion } from "@/components/publication-motion";
import { EvidenceLedger } from "@/components/evidence-ledger";
import { SettlementFlow } from "@/components/settlement-flow";
const github = "https://github.com/ahmardchain/lucid-keeperhub-settlement";

export default function Home() {
  return <main id="top">
    <PublicationMotion />
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Settlement Recovery home">SR<span>Settlement<br />Recovery</span></a>
      <span className="header-edition">TECHNICAL PUBLICATION<br />LUCID × KEEPERHUB / 2026</span>
      <nav aria-label="Primary navigation"><a href="#route">System</a><a href="#evidence">Evidence</a><a href={github} target="_blank" rel="noreferrer">Source <ArrowUpRight /></a></nav>
    </header>
    <section className="editorial-hero" aria-labelledby="hero-title">
      <div className="hero-kicker"><span>01 — COMMERCE FOR AGENTS</span><span>BASE SEPOLIA / USDC</span></div>
      <h1 id="hero-title">Work first.<br /><span>Settle after.</span></h1>
      <figure className="hero-object">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/settlement-gate.png" alt="Conceptual black routing gate guiding a paper receipt around an orange roller, with pencil engineering annotations" width="1536" height="1024" fetchPriority="high" />
        <figcaption><span>FIG. 01 / THE SETTLEMENT GATE</span><span>CONCEPTUAL STUDY</span></figcaption>
      </figure>
      <div className="hero-bottom"><span className="hero-index" aria-hidden="true">↘</span><div><p>Agents get paid for work that holds up.<br />Buyers get refunded when it doesn’t.</p><a className="ink-link" href="#route">Follow the money <ArrowDownRight /></a></div><p className="hero-description">A post-fulfillment settlement layer for Lucid. Payment enters a controlled wallet. Deterministic verification decides what happens next.</p></div>
    </section>
    <section className="thesis-strip"><span className="section-index">THE PRINCIPLE</span><h2>Payment is a start.<br />Proof is the finish.</h2><p>x402 sends USDC into a KeeperHub-controlled wallet before the work finishes. After verification, KeeperHub releases a payout or returns the payment to its verified buyer.</p></section>
    <section id="route" className="route-section">
      <div className="section-heading"><span className="section-index">02 / SYSTEM DRAWING</span><h2>One decision.<br />Two outcomes.</h2><p>Select an outcome to inspect the settlement sequence. This trace explains the logic; it does not send a payment.</p></div>
      <SettlementFlow />
      <div className="custody-note"><span>OPERATOR CUSTODY</span><p>The wallet is not called escrow. KeeperHub is the sole post-task spender. This release uses a controlled settlement account, not a trustless escrow contract.</p></div>
    </section>
    <section id="evidence" className="evidence-section">
      <div className="section-heading"><span className="section-index">03 / FIELD RECORDS</span><h2>Show the<br />receipts.</h2><p>Real Base Sepolia transactions. Every exported record connects the Lucid task, KeeperHub execution and final transfer.</p></div>
      <EvidenceLedger />
      <a className="ink-link evidence-download" href="/evidence/receipts.json" target="_blank" rel="noreferrer">Open the complete receipt bundle <ArrowUpRight /></a>
    </section>
    <section id="recovery" className="recovery-section">
      <div className="section-heading"><span className="section-index">04 / FAILURE PROTOCOL</span><h2>Failure has<br />a way back.</h2><p>The failure demo is the product demo. A missed receipt triggers a refund; uncertain execution is recovered using the saved record.</p></div>
      <div className="recovery-matrix" role="region" aria-label="Recovery behavior table" tabIndex={0}><table><thead><tr><th scope="col">Condition</th><th scope="col">Response</th><th scope="col">Evidence level</th></tr></thead><tbody>
        <tr><th scope="row">01 / Missing receipt</th><td>Refund the verified buyer</td><td>Live testnet receipt</td></tr>
        <tr><th scope="row">02 / Deadline exceeded</th><td>Fix the refund decision</td><td>Automated test</td></tr>
        <tr><th scope="row">03 / Duplicate settlement</th><td>Return the stored result</td><td>Automated test</td></tr>
        <tr><th scope="row">04 / Process interrupted</th><td>Poll the saved execution ID</td><td>Process-kill test; mocked KeeperHub</td></tr>
        <tr><th scope="row">05 / Unverified receipt</th><td>Refuse the finality claim</td><td>Automated test</td></tr>
      </tbody></table></div>
    </section>
    <section className="implementation-section"><div><span className="section-index">05 / BUILDER NOTES</span><h2>Small surface.<br />Hard guarantees.</h2><p>One network. One asset. A deterministic receipt verifier. A stable key that follows the operation through recovery.</p><a className="ink-link" href={`${github}/blob/main/docs/adapter.md`} target="_blank" rel="noreferrer">Build with the adapter <ArrowUpRight /></a></div><div className="code-window"><div className="code-titlebar"><span>SETTLEMENT SEQUENCE</span><span>01—04</span></div><ol><li><span>VERIFY</span><code>schema · deadline · receipts</code></li><li><span>SIMULATE</span><code>check transfer + sender</code></li><li><span>EXECUTE</span><code>stable Idempotency-Key</code></li><li><span>CONFIRM</span><code>verified onchain receipt</code></li></ol><p>Never let a model decide who gets paid.</p></div></section>
    <footer><a className="brand" href="#top">SR<span>Settlement<br />Recovery</span></a><p>LUCID × KEEPERHUB<br />BASE SEPOLIA / EXPERIMENTAL RELEASE</p><a className="ink-link" href={github} target="_blank" rel="noreferrer">Inspect the source <ArrowUpRight /></a><span className="footer-end">END OF RECORD / 001</span></footer>
  </main>;
}
