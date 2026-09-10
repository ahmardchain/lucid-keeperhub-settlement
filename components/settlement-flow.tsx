"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  CircleDollarSign,
  RefreshCcw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";

type DemoPath = "payout" | "refund";

const pathCopy = {
  payout: {
    eyebrow: "Valid output",
    verdict: "OUTPUT_VALID",
    destination: "Worker wallet",
    action: "Release 0.01 USDC",
    icon: Check,
  },
  refund: {
    eyebrow: "Missing receipt",
    verdict: "RECEIPTS_NOT_CONFIRMED",
    destination: "Verified x402 payer",
    action: "Return 0.01 USDC",
    icon: RefreshCcw,
  },
} as const;

export function SettlementFlow() {
  const [path, setPath] = useState<DemoPath>("payout");
  const [run, setRun] = useState(0);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const choosePath = (next: DemoPath) => { setPath(next); setStage(0); setPlaying(true); setRun((value) => value + 1); };
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setPlaying(true); observer.disconnect(); }
    }, { threshold: 0.25 });
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStage(4); setPlaying(false); return; }
    const timers = [1, 2, 3, 4].map((next) => window.setTimeout(() => {
      setStage(next);
      if (next === 4) setPlaying(false);
    }, next * 1100));
    return () => timers.forEach(window.clearTimeout);
  }, [playing, run]);
  const stages = ["Payment signed", "Funds held in settlement wallet", "Lucid task checks receipts", "Verification fixes the outcome", path === "payout" ? "Payout released to worker" : "Refund returned to verified payer"];
  const selected = pathCopy[path];
  const VerdictIcon = selected.icon;

  return (
    <section ref={panel} data-stage={stage} className={`settlement-instrument is-${path} ${playing ? "trace-playing" : ""}`} aria-labelledby="flow-title">
      <div className="instrument-header">
        <div>
          <p className="mono-label">LIVE LOGIC / INTERACTIVE TRACE</p>
          <h2 id="flow-title">Follow the money</h2>
        </div>
        <div className="path-toggle" aria-label="Choose a settlement outcome">
          <button
            type="button"
            aria-pressed={path === "payout"}
            onClick={() => choosePath("payout")}
          >
            <Check aria-hidden="true" />
            Payout path
          </button>
          <button
            type="button"
            aria-pressed={path === "refund"}
            onClick={() => choosePath("refund")}
          >
            <X aria-hidden="true" />
            Refund path
          </button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {path === "payout"
          ? "Payout path selected. Valid output releases USDC to the worker."
          : "Refund path selected. Missing receipt returns USDC to the verified payer."}
      </p>

      <div className="trace-transport">
        <div aria-live="polite"><span className="trace-step">0{stage + 1} / 05</span><span>{stages[stage]}</span></div>
        <button type="button" onClick={() => choosePath(path)}><RefreshCcw aria-hidden="true" /> {playing ? "Restart trace" : "Replay trace"}</button>
      </div>
      <div className="trace-progress" aria-hidden="true"><span style={{ width: `${(stage + 1) * 20}%` }} /></div>
      <div className="route-board" key={run}>
        <div className="route-network mono-label">
          <span>BASE SEPOLIA</span>
          <span>eip155:84532</span>
        </div>

        <ol className="route-core" aria-label="Settlement sequence">
          <li className="route-node">
            <span className="node-index">01</span>
            <WalletCards aria-hidden="true" />
            <strong>Buyer</strong>
            <small>Signs exact x402 payment</small>
          </li>
          <li className="route-link route-link-amber" aria-label="0.01 USDC moves">
            <span className="route-packet">0.01</span>
          </li>
          <li className="route-node custody-node">
            <span className="node-index">02</span>
            <CircleDollarSign aria-hidden="true" />
            <strong>Settlement wallet</strong>
            <small>KeeperHub-controlled custody</small>
            <span className="custody-flag">FUNDS HELD</span>
          </li>
          <li className="route-link" aria-hidden="true">
            <span className="route-packet route-packet-task">task</span>
          </li>
          <li className="route-node">
            <span className="node-index">03</span>
            <span className="lucid-glyph" aria-hidden="true">L</span>
            <strong>Lucid task</strong>
            <small>Audits Base Sepolia receipts</small>
          </li>
        </ol>

        <ArrowDown className="route-drop" aria-hidden="true" />

        <div className="verifier-gate">
          <div className="gate-icon"><ShieldCheck aria-hidden="true" /></div>
          <div>
            <span className="mono-label">DETERMINISTIC GATE / NO LLM</span>
            <strong>{selected.verdict}</strong>
            <small>{selected.eyebrow} fixes one immutable direction.</small>
          </div>
          <VerdictIcon aria-hidden="true" className="verdict-mark" />
        </div>

        <div className="branch-board" aria-label="Payout and refund branches">
          <article className={`branch-lane payout-lane ${path === "payout" ? "is-active" : ""}`}>
            <span className="branch-state"><Check aria-hidden="true" /> PAYOUT</span>
            <strong>Worker wallet</strong>
            <small>Only after every receipt is verified successful.</small>
          </article>
          <div className="keeper-node">
            <span className="node-index">04</span>
            <span className="keeper-glyph" aria-hidden="true">K</span>
            <div>
              <strong>KeeperHub</strong>
              <small>simulate → execute once → verify receipt</small>
            </div>
          </div>
          <article className={`branch-lane refund-lane ${path === "refund" ? "is-active" : ""}`}>
            <span className="branch-state"><RefreshCcw aria-hidden="true" /> REFUND</span>
            <strong>Verified payer</strong>
            <small>Never a caller-supplied refund address.</small>
          </article>
        </div>
      </div>

      <dl className="instrument-readout" key={`readout-${run}`}>
        <div>
          <dt>Terminal action</dt>
          <dd>{selected.action}</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{selected.destination}</dd>
        </div>
        <div>
          <dt>Replay policy</dt>
          <dd>Same operation, same key</dd>
        </div>
      </dl>
    </section>
  );
}
