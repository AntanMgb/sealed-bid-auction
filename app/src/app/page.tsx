"use client";

import { useState, useEffect, useCallback } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { CreateAuction } from "@/components/CreateAuction";
import { AuctionRoom } from "@/components/AuctionRoom";
import { getProgram, fetchAllAuctions, fetchAuction, AuctionState } from "@/lib/program";
import { getDevnetConnection, getMagicRouterConnection } from "@/lib/magicblock";

function FaqItem({ question, children }: { question: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
        style={{ background: open ? "var(--surface-hover)" : "transparent" }}
      >
        <span className="font-semibold text-base" style={{ color: "var(--accent-magenta)" }}>{question}</span>
        <span
          className="rounded-full w-6 h-6 flex items-center justify-center text-sm transition-transform"
          style={{ border: "1px solid var(--border)", color: "var(--text-dim)", transform: open ? "rotate(45deg)" : "none" }}
        >
          +
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0">
          {children}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { connected, publicKey, signTransaction } = useWallet();
  const [auctionPdaRaw, setAuctionPdaRaw] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");

  function setAuctionPda(pda: string | null) {
    setAuctionPdaRaw(pda);
    if (pda) {
      window.history.pushState({}, "", `?auction=${pda}`);
    } else {
      window.history.pushState({}, "", window.location.pathname);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auc = params.get("auction");
    if (auc) setAuctionPdaRaw(auc);
  }, []);

  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      setAuctionPdaRaw(params.get("auction"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const [auctions, setAuctions] = useState<{ publicKey: PublicKey; account: AuctionState }[]>([]);
  const [loadingAuctions, setLoadingAuctions] = useState(false);
  const [myAuctions, setMyAuctions] = useState<{ pda: string; title: string; createdAt: number; status?: string }[]>([]);

  // Clear stale localStorage from old program deployments
  useEffect(() => {
    const CURRENT_PROGRAM = "FSo5XfH1WpttJYtGqLL2GFyBpbn54XDxvqFhYCFTLuwh";
    try {
      const lastProgram = localStorage.getItem("program-id");
      if (lastProgram !== CURRENT_PROGRAM) {
        localStorage.removeItem("my-auctions");
        localStorage.removeItem("auction-registry");
        localStorage.setItem("program-id", CURRENT_PROGRAM);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved: { pda: string; title: string; createdAt: number }[] =
        JSON.parse(localStorage.getItem("my-auctions") || "[]");
      setMyAuctions(saved);
    } catch {}
  }, []);

  function registerAuction(pdaStr: string, title?: string) {
    try {
      const existing: { pda: string; title: string; createdAt: number }[] =
        JSON.parse(localStorage.getItem("my-auctions") || "[]");
      if (!existing.some((a) => a.pda === pdaStr)) {
        const entry = { pda: pdaStr, title: title || "Untitled", createdAt: Date.now() };
        const updated = [entry, ...existing];
        localStorage.setItem("my-auctions", JSON.stringify(updated));
        setMyAuctions(updated);
      }
      const registry: string[] = JSON.parse(localStorage.getItem("auction-registry") || "[]");
      if (!registry.includes(pdaStr)) {
        registry.push(pdaStr);
        localStorage.setItem("auction-registry", JSON.stringify(registry));
      }
    } catch {}
  }

  const loadAuctions = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    setLoadingAuctions(true);
    try {
      const makeProvider = (conn: any) => new AnchorProvider(
        conn,
        { publicKey, signTransaction, signAllTransactions: async (t: any) => t },
        { commitment: "confirmed" }
      );
      const l1Program = getProgram(makeProvider(getDevnetConnection()));
      const l1Auctions = await fetchAllAuctions(l1Program);
      const registry: string[] = JSON.parse(localStorage.getItem("auction-registry") || "[]");
      const l1Keys = new Set(l1Auctions.map((a) => a.publicKey.toBase58()));
      const routerProgram = getProgram(makeProvider(getMagicRouterConnection()));
      const registryResults: { publicKey: PublicKey; account: AuctionState }[] = [];
      for (const pdaStr of registry) {
        if (l1Keys.has(pdaStr)) continue;
        try {
          const pk = new PublicKey(pdaStr);
          const data = await fetchAuction(routerProgram, pk);
          if (data) registryResults.push({ publicKey: pk, account: data });
        } catch {}
      }
      const merged = [...registryResults, ...l1Auctions];
      merged.sort((a, b) => b.account.startTime.toNumber() - a.account.startTime.toNumber());
      setAuctions(merged.slice(0, 5));
    } catch (err) {
      console.error("Failed to fetch auctions:", err);
    } finally {
      setLoadingAuctions(false);
    }
  }, [publicKey, signTransaction]);

  useEffect(() => {
    if (connected) { loadAuctions(); }
  }, [connected, loadAuctions]);

  function getStatusLabel(status: AuctionState["status"], endTime?: number) {
    if ("settled" in status) return { label: "Settled", cls: "text-[var(--accent-magenta)] border-[var(--accent-magenta)]/30 bg-[var(--accent-magenta)]/10" };
    if ("cancelled" in status) return { label: "Cancelled", cls: "text-gray-400 border-gray-400/30 bg-gray-400/10" };
    if ("closed" in status) return { label: "Closed", cls: "text-green-400 border-green-400/30 bg-green-400/10" };
    if (endTime && Date.now() >= endTime * 1000) return { label: "Expired", cls: "text-[var(--accent-amber)] border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10" };
    if ("delegated" in status) return { label: "Live", cls: "text-[var(--accent-violet)] border-[var(--accent-violet)]/30 bg-[var(--accent-violet)]/10" };
    return { label: "Created", cls: "text-[var(--accent-blue)] border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10" };
  }

  return (
    <main className="min-h-screen" style={{ color: "var(--text)" }}>
      {/* Nav */}
      <header className="sticky top-0 z-10 backdrop-blur-md" style={{ background: "rgba(5,5,8,0.8)", borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setAuctionPda(null)}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <img src="/logo.png" alt="Magic Auction" className="w-9 h-9 rounded-lg" />
            <div className="text-left">
              <div className="font-bold text-white" style={{ fontFamily: "'Unbounded', sans-serif", fontSize: "16px" }}>Magic Auction</div>
              <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                Powered by MagicBlock PER
              </div>
            </div>
          </button>
          <WalletMultiButton />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        {!auctionPdaRaw && (
          <div className="text-center mb-12">
            <div className="flex justify-center mb-5">
              <img src="/logo.png" alt="Magic Auction" className="w-20 h-20 rounded-2xl glow" />
            </div>
            <h1 className="gradient-text text-4xl md:text-5xl font-black mb-4 pb-2" style={{ fontFamily: "'Unbounded', sans-serif" }}>
              Magic Auction
            </h1>
            <p className="max-w-2xl mx-auto text-lg leading-relaxed" style={{ color: "var(--text-mid)" }}>
              Trustless sealed-bid auctions on Solana.{" "}
              <strong className="text-white">
                Winner computed inside Intel TDX enclave
              </strong>
              , committed onchain with verifiable attestation.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {[
                "Bids sealed in TEE",
                "Real-time via MagicBlock ER",
                "Verifiable attestation",
                "Intel TDX privacy",
                "Committed to Solana L1",
              ].map((label) => (
                <span key={label} className="pill" style={{ color: "var(--text-mid)", fontSize: "12px" }}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {!connected ? (
          <div className="flex flex-col items-center justify-center py-20 gap-5">
            <img src="/logo.png" alt="Magic Auction" className="w-16 h-16 rounded-xl opacity-40" />
            <p style={{ color: "var(--text-dim)", fontSize: "18px" }}>Connect your wallet to start</p>
            <WalletMultiButton />
          </div>
        ) : auctionPdaRaw ? (
          <div>
            <button
              onClick={() => setAuctionPda(null)}
              className="flex items-center gap-2 text-sm mb-4 transition-colors hover:text-white"
              style={{ color: "var(--text-dim)" }}
            >
              <span>←</span> Back to all auctions
            </button>
            <AuctionRoom auctionPdaStr={auctionPdaRaw} />
          </div>
        ) : (
          <div>
            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: Create Auction (wider) */}
              <div className="lg:col-span-3">
                <CreateAuction onCreated={(pda, title) => { registerAuction(pda, title); loadAuctions(); setAuctionPda(pda); }} />
              </div>

              {/* Right: sidebar */}
              <div className="lg:col-span-2 space-y-5">
                {/* Join by PDA */}
                <div className="card p-5">
                  <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: "'Unbounded', sans-serif" }}>
                    Join by Address
                  </h2>
                  <div className="flex gap-2">
                    <input
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                      placeholder="Paste auction PDA..."
                      className="input mono flex-1"
                      style={{ fontSize: "12px" }}
                    />
                    <button
                      onClick={() => { if (joinInput) { registerAuction(joinInput); setAuctionPda(joinInput); } }}
                      disabled={!joinInput}
                      className="btn-accent shrink-0 disabled:opacity-30"
                      style={{ padding: "10px 18px" }}
                    >
                      Go
                    </button>
                  </div>
                </div>

                {/* My Auctions */}
                {myAuctions.length > 0 && (() => {
                  const liveOne = myAuctions.find((a) => a.status === "live");
                  const closedOne = myAuctions.find((a) => a.status === "closed" || a.status === "settled");
                  const shown = [liveOne, closedOne].filter(Boolean) as typeof myAuctions;
                  if (shown.length === 0) shown.push(...myAuctions.slice(0, 2));
                  const statusBadge = (s?: string) => {
                    if (s === "live") return <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--accent-violet)", background: "rgba(136,51,255,0.15)", border: "1px solid rgba(136,51,255,0.3)" }}>Live</span>;
                    if (s === "closed" || s === "settled") return <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)" }}>Closed</span>;
                    if (s === "expired") return <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--accent-amber)", background: "rgba(255,170,34,0.1)", border: "1px solid rgba(255,170,34,0.3)" }}>Expired</span>;
                    return null;
                  };
                  return (
                    <div className="card p-5">
                      <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: "'Unbounded', sans-serif" }}>My Auctions</h2>
                      <div className="space-y-2">
                        {shown.map((a) => (
                          <button
                            key={a.pda}
                            onClick={() => setAuctionPda(a.pda)}
                            className="w-full text-left rounded-xl p-3 transition-all hover:-translate-y-0.5"
                            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-white text-sm truncate">{a.title}</div>
                                <div className="mono text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{a.pda.slice(0, 20)}...</div>
                              </div>
                              {statusBadge(a.status)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Browse All */}
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-bold text-white" style={{ fontFamily: "'Unbounded', sans-serif" }}>Browse All</h2>
                    <button onClick={loadAuctions} disabled={loadingAuctions} className="text-xs transition-colors" style={{ color: "var(--accent-violet)" }}>
                      {loadingAuctions ? "..." : "Refresh"}
                    </button>
                  </div>
                  {loadingAuctions && auctions.length === 0 ? (
                    <div className="text-center py-6 text-xs" style={{ color: "var(--text-dim)" }}>Loading...</div>
                  ) : auctions.length === 0 ? (
                    <div className="text-center py-6 text-xs" style={{ color: "var(--text-dim)" }}>No auctions yet</div>
                  ) : (
                    <div className="space-y-2">
                      {auctions.map((a) => {
                        const s = getStatusLabel(a.account.status, a.account.endTime.toNumber());
                        const endMs = a.account.endTime.toNumber() * 1000;
                        const isExpired = Date.now() >= endMs;
                        const isActive = !isExpired && ("delegated" in a.account.status || "created" in a.account.status);
                        return (
                          <button
                            key={a.publicKey.toBase58()}
                            onClick={() => setAuctionPda(a.publicKey.toBase58())}
                            className="w-full text-left rounded-xl p-3 transition-all hover:-translate-y-0.5"
                            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold text-white text-sm truncate">{a.account.title || "Untitled"}</div>
                                <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: "var(--text-dim)" }}>
                                  <span>{(a.account.reservePrice.toNumber() / 1e9).toFixed(3)} SOL</span>
                                  <span>{a.account.bidCount} bids</span>
                                  {isActive && <span style={{ color: "var(--accent-violet)" }}>Active</span>}
                                </div>
                              </div>
                              <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* How it works mini */}
                <div className="card p-5">
                  <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: "'Unbounded', sans-serif" }}>How It Works</h2>
                  <div className="space-y-3">
                    {[
                      { num: "1", label: "Create", desc: "Set up auction on Solana L1", color: "var(--accent-blue)" },
                      { num: "2", label: "Delegate", desc: "Move to TEE (Intel TDX)", color: "var(--accent-violet)" },
                      { num: "3", label: "Bid", desc: "Sealed bids inside enclave", color: "var(--accent-magenta)" },
                      { num: "4", label: "Reveal", desc: "TEE computes winner", color: "var(--accent-pink)" },
                      { num: "5", label: "Settle", desc: "Result committed to L1", color: "#4ade80" },
                    ].map((s) => (
                      <div key={s.num} className="flex items-center gap-3">
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ background: s.color, color: "white" }}
                        >
                          {s.num}
                        </span>
                        <div>
                          <span className="text-sm font-semibold text-white">{s.label}</span>
                          <span className="text-xs ml-2" style={{ color: "var(--text-dim)" }}>{s.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FAQ */}
        {!auctionPdaRaw && connected && (
          <div className="max-w-3xl mx-auto mt-12 pb-16">
            <h2 className="text-xl font-bold text-white mb-4" style={{ fontFamily: "'Unbounded', sans-serif" }}>Learn More</h2>
            <div className="space-y-2">
              {[
                {
                  q: "How does it work?",
                  a: (
                    <div className="space-y-3 text-sm">
                      {[
                        { num: "1", layer: "L1", title: "Create Auction", desc: "Seller creates an auction on Solana L1 specifying the item, reserve price, and duration." },
                        { num: "2", layer: "L1", title: "Delegate to TEE", desc: "The auction is delegated to MagicBlock's Private Ephemeral Rollup inside an Intel TDX enclave." },
                        { num: "3", layer: "TEE", title: "Submit Sealed Bids", desc: "Bidders authenticate and submit bids directly into the enclave. Amounts are never visible on L1." },
                        { num: "4", layer: "TEE", title: "Winner Computation", desc: "The TEE determines the highest bidder and commits the result to L1 with Intel TDX attestation." },
                        { num: "5", layer: "L1", title: "Settlement", desc: "The winner pays on L1. The escrowed item is atomically transferred." },
                      ].map((s) => (
                        <div key={s.num} className="flex gap-3">
                          <div className="shrink-0 flex flex-col items-center">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>{s.num}</span>
                            {s.num !== "5" && <div className="w-px h-full mt-1" style={{ background: "var(--border)" }} />}
                          </div>
                          <div className="pb-3">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] mono px-1.5 py-0.5 rounded" style={{ background: s.layer === "TEE" ? "var(--accent-violet)" : "var(--accent-blue)", color: "white" }}>{s.layer}</span>
                              <span className="font-semibold text-white text-sm">{s.title}</span>
                            </div>
                            <p style={{ color: "var(--text-mid)" }} className="text-sm leading-relaxed">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  q: "What are Private Ephemeral Rollups (PER)?",
                  a: (
                    <div className="text-sm space-y-3 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                      <p><strong className="text-white">Private Ephemeral Rollups</strong> by <strong style={{ color: "var(--accent-violet)" }}>MagicBlock</strong> combine Ephemeral Rollups with <strong className="text-white">Intel TDX TEE</strong>.</p>
                      <p>Standard ERs accelerate Solana by delegating accounts to a high-performance rollup. <strong className="text-white">Private</strong> ERs run inside Intel TDX — a hardware secure enclave:</p>
                      <ul className="list-none space-y-2 ml-2">
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-violet)" }}>→</span><span><strong className="text-white">Data privacy:</strong> State inside TEE is unreadable — even by the node operator</span></li>
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-violet)" }}>→</span><span><strong className="text-white">Verifiable computation:</strong> Intel-attested TEE key proves genuine TDX execution</span></li>
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-violet)" }}>→</span><span><strong className="text-white">Same Solana program:</strong> Your Anchor program runs as-is on PER</span></li>
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-violet)" }}>→</span><span><strong className="text-white">Composable with L1:</strong> Full settlement guarantees on Solana</span></li>
                      </ul>
                    </div>
                  ),
                },
                {
                  q: "Why do sealed-bid auctions need TEE?",
                  a: (
                    <div className="text-sm space-y-3 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                      <p>On-chain auctions expose all bids publicly:</p>
                      <ul className="list-none space-y-2 ml-2">
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-pink)" }}>✗</span><span><strong className="text-white">Front-running:</strong> MEV bots outbid visible transactions</span></li>
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-pink)" }}>✗</span><span><strong className="text-white">Bid sniping:</strong> Bidders watch and wait for last-second advantage</span></li>
                        <li className="flex items-start gap-2"><span style={{ color: "var(--accent-pink)" }}>✗</span><span><strong className="text-white">Floor manipulation:</strong> Fake bids inflate prices</span></li>
                      </ul>
                      <p>With <strong style={{ color: "var(--accent-violet)" }}>MagicBlock PER</strong>, bids go directly to the Intel TDX enclave. The TEE computes the winner honestly and commits only the result with cryptographic attestation.</p>
                    </div>
                  ),
                },
                {
                  q: "What can I auction?",
                  a: (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { icon: "🎨", title: "NFTs", desc: "Sealed-bid NFT auctions with escrow." },
                        { icon: "🪙", title: "Token Sales", desc: "Fair price discovery for launches." },
                        { icon: "🏛️", title: "Governance Seats", desc: "DAO seat auctions, no underbidding." },
                      ].map((uc) => (
                        <div key={uc.title} className="rounded-xl p-3" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
                          <div className="text-xl mb-1">{uc.icon}</div>
                          <div className="font-semibold text-white text-sm mb-1">{uc.title}</div>
                          <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>{uc.desc}</p>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  q: "Who can participate?",
                  a: <p className="text-sm leading-relaxed" style={{ color: "var(--text-mid)" }}>Anyone with a Solana wallet. No registration needed — fully permissionless and trustless.</p>,
                },
                {
                  q: "Technology stack",
                  a: (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        { name: "Solana", desc: "L1 Settlement" }, { name: "Anchor", desc: "Program Framework" },
                        { name: "MagicBlock", desc: "Private ER Engine" }, { name: "Intel TDX", desc: "Hardware TEE" },
                        { name: "Next.js", desc: "Frontend" }, { name: "Phantom", desc: "Wallet" },
                        { name: "Borsh", desc: "Serialization" }, { name: "Rust", desc: "On-chain" },
                      ].map((t) => (
                        <div key={t.name} className="rounded-lg p-2.5 text-center" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
                          <div className="font-semibold text-white text-sm">{t.name}</div>
                          <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{t.desc}</div>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ].map((item, i) => (
                <FaqItem key={i} question={item.q}>{item.a}</FaqItem>
              ))}
            </div>

            {/* Hackathon badge */}
            <div className="card p-5 mt-8 text-center glow">
              <div className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--accent-violet)" }}>Built for</div>
              <div className="text-lg font-bold text-white" style={{ fontFamily: "'Unbounded', sans-serif" }}>MagicBlock Solana Blitz Hackathon V2</div>
              <div className="text-sm" style={{ color: "var(--text-mid)" }}>March 2026 — Private Ephemeral Rollups Track</div>
              <div className="mt-2 text-xs mono" style={{ color: "var(--text-dim)" }}>
                Program ID: FSo5XfH1WpttJYtGqLL2GFyBpbn54XDxvqFhYCFTLuwh
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
