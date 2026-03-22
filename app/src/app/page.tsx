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
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-800/50 transition-colors"
      >
        <span className="font-semibold text-fuchsia-400 text-base">{question}</span>
        <span className={`text-gray-400 border border-gray-600 rounded-full w-6 h-6 flex items-center justify-center text-sm transition-transform ${open ? "rotate-45" : ""}`}>
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
  const [auctionPda, setAuctionPdaRaw] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [activeView, setActiveView] = useState<"create" | "join" | "browse">("create");

  // Sync auctionPda with URL query param
  function setAuctionPda(pda: string | null) {
    setAuctionPdaRaw(pda);
    if (pda) {
      window.history.pushState({}, "", `?auction=${pda}`);
    } else {
      window.history.pushState({}, "", window.location.pathname);
    }
  }

  // Read auction PDA from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auc = params.get("auction");
    if (auc) setAuctionPdaRaw(auc);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      const auc = params.get("auction");
      setAuctionPdaRaw(auc);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [auctions, setAuctions] = useState<{ publicKey: PublicKey; account: AuctionState }[]>([]);
  const [loadingAuctions, setLoadingAuctions] = useState(false);
  const [myAuctions, setMyAuctions] = useState<{ pda: string; title: string; createdAt: number; status?: string }[]>([]);

  // Load my auctions from localStorage and fetch their statuses
  useEffect(() => {
    try {
      const saved: { pda: string; title: string; createdAt: number }[] =
        JSON.parse(localStorage.getItem("my-auctions") || "[]");
      setMyAuctions(saved);

      // Fetch statuses in background
      if (publicKey && signTransaction && saved.length > 0) {
        (async () => {
          const makeProvider = (conn: any) => new AnchorProvider(
            conn,
            { publicKey, signTransaction, signAllTransactions: async (t: any) => t },
            { commitment: "confirmed" }
          );
          const routerProg = getProgram(makeProvider(getMagicRouterConnection()));
          const updated = await Promise.all(
            saved.map(async (a) => {
              try {
                const data = await fetchAuction(routerProg, new PublicKey(a.pda));
                if (!data) return { ...a, status: "unknown" };
                if ("settled" in data.status) return { ...a, status: "settled" };
                if ("closed" in data.status) return { ...a, status: "closed" };
                const expired = Date.now() >= data.endTime.toNumber() * 1000;
                if (expired) return { ...a, status: "expired" };
                return { ...a, status: "live" };
              } catch {
                return { ...a, status: "unknown" };
              }
            })
          );
          setMyAuctions(updated);
        })();
      }
    } catch {}
  }, [publicKey, signTransaction]);

  // Save auction to "My Auctions" in localStorage
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
      // Also save to registry for browse
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

      // 1. Fetch L1 auctions (non-delegated: created, closed, settled)
      const l1Program = getProgram(makeProvider(getDevnetConnection()));
      const l1Auctions = await fetchAllAuctions(l1Program);

      // 2. Fetch registry auctions via Magic Router (includes delegated/active)
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

      // Newest first, limit to 5
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
    if (activeView === "browse" && connected) {
      loadAuctions();
    }
  }, [activeView, connected, loadAuctions]);

  function getStatusLabel(status: AuctionState["status"]) {
    if ("settled" in status) return { label: "Settled", color: "text-purple-400 bg-purple-900/50 border-purple-700" };
    if ("closed" in status) return { label: "Closed", color: "text-green-400 bg-green-900/50 border-green-700" };
    if ("delegated" in status) return { label: "Live in TEE", color: "text-teal-400 bg-teal-900/50 border-teal-700" };
    return { label: "Created", color: "text-blue-400 bg-blue-900/50 border-blue-700" };
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setAuctionPda(null)}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span className="text-xl">🔒</span>
            <div className="text-left">
              <div className="font-bold text-white">Sealed-Bid Auction</div>
              <div className="text-[10px] text-gray-500">
                Powered by MagicBlock Private ER (Intel TDX)
              </div>
            </div>
          </button>
          <WalletMultiButton />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        {!auctionPda && (
          <div className="text-center mb-10">
            <h1 className="text-4xl font-extrabold text-white mb-3">
              Trustless Sealed-Bid Auction
            </h1>
            <p className="text-gray-400 max-w-2xl mx-auto text-lg">
              All bids stay hidden until the auction closes.{" "}
              <strong className="text-white">
                Winner computed in Intel TDX enclave
              </strong>
              , committed onchain with a verifiable attestation.
              <br />
              No floor manipulation. No sniping. No insider info.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {[
                { icon: "🔒", label: "Bids sealed in TEE" },
                { icon: "⚡", label: "Real-time via MagicBlock ER" },
                { icon: "✅", label: "Verifiable TEE attestation" },
                { icon: "🛡️", label: "Intel TDX hardware privacy" },
                { icon: "🔗", label: "Committed to Solana L1" },
              ].map((f) => (
                <span
                  key={f.label}
                  className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-full text-sm text-gray-300"
                >
                  <span>{f.icon}</span>
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {!connected ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <span className="text-5xl">🔐</span>
            <p className="text-gray-400 text-lg">Connect your wallet to start</p>
            <WalletMultiButton />
          </div>
        ) : auctionPda ? (
          <div>
            <button
              onClick={() => setAuctionPda(null)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
            >
              <span>←</span> Back to all auctions
            </button>
            <AuctionRoom auctionPdaStr={auctionPda} />
          </div>
        ) : (
          <div className="max-w-xl mx-auto">
            {/* Tab switcher */}
            <div className="flex bg-gray-800 rounded-xl p-1 mb-5">
              {(["create", "join", "browse"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setActiveView(v)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === v
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {v === "create" ? "Create Auction" : v === "join" ? "Join Auction" : "Browse All"}
                </button>
              ))}
            </div>

            {activeView === "create" ? (
              <CreateAuction onCreated={(pda, title) => { registerAuction(pda, title); setAuctionPda(pda); }} />
            ) : activeView === "join" ? (
              <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
                <h2 className="text-lg font-semibold text-white mb-4">
                  Join Existing Auction
                </h2>
                <label className="text-xs text-gray-400 block mb-1">
                  Auction PDA address
                </label>
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="Enter auction PDA..."
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-teal-500 mb-3"
                />
                <button
                  onClick={() => { if (joinInput) { registerAuction(joinInput); setAuctionPda(joinInput); } }}
                  disabled={!joinInput}
                  className="w-full py-2.5 rounded-lg font-semibold text-sm bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 transition-all"
                >
                  View Auction
                </button>
              </div>
            ) : (
              /* Browse All Auctions */
              <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">All Auctions</h2>
                  <button
                    onClick={loadAuctions}
                    disabled={loadingAuctions}
                    className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50"
                  >
                    {loadingAuctions ? "Loading..." : "Refresh"}
                  </button>
                </div>

                {loadingAuctions && auctions.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-2xl mb-2">⏳</div>
                    Loading auctions from Solana...
                  </div>
                ) : auctions.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-2xl mb-2">📭</div>
                    No auctions found on-chain yet. Create one!
                  </div>
                ) : (
                  <div className="space-y-3">
                    {auctions.map((a) => {
                      const s = getStatusLabel(a.account.status);
                      const endMs = a.account.endTime.toNumber() * 1000;
                      const isExpired = Date.now() >= endMs;
                      const isActive = !isExpired && ("delegated" in a.account.status || "created" in a.account.status);
                      return (
                        <button
                          key={a.publicKey.toBase58()}
                          onClick={() => setAuctionPda(a.publicKey.toBase58())}
                          className="w-full text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-lg p-4 transition-all"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-white truncate">
                                {a.account.title || "Untitled Auction"}
                              </div>
                              <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                                {a.publicKey.toBase58().slice(0, 16)}...
                              </div>
                            </div>
                            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${s.color}`}>
                              {s.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                            <span>Reserve: {(a.account.reservePrice.toNumber() / 1e9).toFixed(3)} SOL</span>
                            <span>Bids: {a.account.bidCount}</span>
                            {isActive && (
                              <span className="text-teal-400">
                                Active
                              </span>
                            )}
                            {isExpired && !("closed" in a.account.status) && !("settled" in a.account.status) && (
                              <span className="text-orange-400">Expired</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* My Auctions — show latest live + latest closed */}
            {myAuctions.length > 0 && (() => {
              const liveOne = myAuctions.find((a) => a.status === "live");
              const closedOne = myAuctions.find((a) => a.status === "closed" || a.status === "settled");
              const shown = [liveOne, closedOne].filter(Boolean) as typeof myAuctions;
              if (shown.length === 0) {
                // Fallback: show the 2 most recent if statuses not loaded yet
                shown.push(...myAuctions.slice(0, 2));
              }
              const statusBadge = (s?: string) => {
                if (s === "live") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-900/50 border border-teal-700 text-teal-400">Live</span>;
                if (s === "closed" || s === "settled") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/50 border border-green-700 text-green-400">Closed</span>;
                if (s === "expired") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-900/50 border border-orange-700 text-orange-400">Expired</span>;
                return null;
              };
              return (
                <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 mt-5">
                  <h2 className="text-lg font-semibold text-white mb-3">My Auctions</h2>
                  <div className="space-y-2">
                    {shown.map((a) => (
                      <button
                        key={a.pda}
                        onClick={() => setAuctionPda(a.pda)}
                        className="w-full text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-lg p-3 transition-all"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-white text-sm truncate">{a.title}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                              {a.pda.slice(0, 20)}...
                            </div>
                          </div>
                          {statusBadge(a.status)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* FAQ Accordion — shown on home page */}
        {!auctionPda && connected && (
          <div className="max-w-3xl mx-auto mt-12 pb-16">
            <h2 className="text-xl font-bold text-white mb-4">Learn More</h2>
            <div className="space-y-2">
              {[
                {
                  q: "How does it work?",
                  a: (
                    <div className="space-y-3 text-sm">
                      {[
                        { num: "1", layer: "L1", color: "bg-blue-600", title: "Create Auction", desc: "Seller creates an auction on Solana L1 specifying the item, reserve price, and duration." },
                        { num: "2", layer: "L1", color: "bg-blue-600", title: "Delegate to TEE", desc: "The auction account is delegated to MagicBlock's Private Ephemeral Rollup running inside an Intel TDX enclave." },
                        { num: "3", layer: "TEE", color: "bg-teal-600", title: "Submit Sealed Bids", desc: "Bidders authenticate with the TEE and submit bids directly into the enclave. Amounts are never visible on L1." },
                        { num: "4", layer: "TEE", color: "bg-teal-600", title: "Winner Computation", desc: "The TEE reads all sealed bids, determines the highest bidder, and commits the result to Solana L1 with an Intel TDX attestation." },
                        { num: "5", layer: "L1", color: "bg-purple-600", title: "Settlement", desc: "The winner pays the winning bid on L1. The escrowed NFT/token is atomically transferred to the winner." },
                      ].map((s) => (
                        <div key={s.num} className="flex gap-3">
                          <div className="shrink-0 flex flex-col items-center">
                            <span className="w-6 h-6 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center text-xs font-bold text-white">{s.num}</span>
                            {s.num !== "5" && <div className="w-px h-full bg-gray-700 mt-1" />}
                          </div>
                          <div className="pb-3">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`${s.color} text-white text-[10px] font-mono px-1.5 py-0.5 rounded`}>{s.layer}</span>
                              <span className="font-semibold text-white text-sm">{s.title}</span>
                            </div>
                            <p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  q: "What are Private Ephemeral Rollups (PER)?",
                  a: (
                    <div className="text-sm text-gray-400 space-y-3 leading-relaxed">
                      <p><strong className="text-white">Private Ephemeral Rollups</strong> are a novel primitive by <strong className="text-teal-400">MagicBlock</strong> that combines Ephemeral Rollups with <strong className="text-white">Intel TDX Trusted Execution Environments</strong>.</p>
                      <p>Standard Ephemeral Rollups accelerate Solana programs by temporarily &quot;delegating&quot; on-chain accounts to a high-performance rollup. The ER processes transactions at high speed, then commits results back to Solana L1.</p>
                      <p><strong className="text-white">Private</strong> ERs go further: the rollup runs inside an Intel TDX Trust Domain — a hardware-level secure enclave:</p>
                      <ul className="list-none space-y-2 ml-2">
                        <li className="flex items-start gap-2"><span className="text-teal-400 mt-0.5">→</span><span><strong className="text-white">Data privacy:</strong> Account state inside the TEE cannot be read by anyone — not even the node operator</span></li>
                        <li className="flex items-start gap-2"><span className="text-teal-400 mt-0.5">→</span><span><strong className="text-white">Verifiable computation:</strong> The TEE&apos;s public key is attested by Intel — anyone can verify it ran inside a genuine TDX enclave</span></li>
                        <li className="flex items-start gap-2"><span className="text-teal-400 mt-0.5">→</span><span><strong className="text-white">Same Solana program:</strong> No separate smart contracts needed — your existing Anchor program runs as-is</span></li>
                        <li className="flex items-start gap-2"><span className="text-teal-400 mt-0.5">→</span><span><strong className="text-white">Composable with L1:</strong> Results are committed back to Solana with full settlement guarantees</span></li>
                      </ul>
                    </div>
                  ),
                },
                {
                  q: "Why do sealed-bid auctions need TEE?",
                  a: (
                    <div className="text-sm text-gray-400 space-y-3 leading-relaxed">
                      <p>In a traditional on-chain auction, all bids are public. This creates problems:</p>
                      <ul className="list-none space-y-2 ml-2">
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">✗</span><span><strong className="text-white">Front-running:</strong> Validators or MEV bots can see pending bids and outbid them</span></li>
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">✗</span><span><strong className="text-white">Bid sniping:</strong> Bidders wait until the last second, watching others&apos; bids</span></li>
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">✗</span><span><strong className="text-white">Floor manipulation:</strong> Sellers can create fake bids to drive up the price</span></li>
                      </ul>
                      <p>With <strong className="text-teal-400">MagicBlock PER</strong>, bid amounts are sent directly to the Intel TDX enclave and never appear in any public state. The TEE computes the winner honestly and commits only the final result — with a cryptographic attestation proving fair computation.</p>
                    </div>
                  ),
                },
                {
                  q: "What can I auction?",
                  a: (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { icon: "🎨", title: "NFTs", desc: "Sell NFTs via sealed-bid auction. The NFT is escrowed in the program and atomically transferred to the winner." },
                        { icon: "🪙", title: "Token Sales", desc: "Fair price discovery for token launches. Bidders submit private valuations, ensuring the market price reflects true demand." },
                        { icon: "🏛️", title: "Governance Seats", desc: "DAOs can auction governance seats. Sealed bids prevent strategic underbidding and ensure fair representation." },
                      ].map((uc) => (
                        <div key={uc.title} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                          <div className="text-xl mb-1">{uc.icon}</div>
                          <div className="font-semibold text-white text-sm mb-1">{uc.title}</div>
                          <p className="text-xs text-gray-400 leading-relaxed">{uc.desc}</p>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  q: "Who can participate?",
                  a: (
                    <p className="text-sm text-gray-400 leading-relaxed">
                      Anyone with a Solana wallet (e.g. Phantom) can create or join auctions. Sellers create auctions and set the terms. Bidders connect their wallet, authenticate with the TEE, and submit sealed bids. No registration or approval is needed — the system is fully permissionless and trustless.
                    </p>
                  ),
                },
                {
                  q: "Technology stack",
                  a: (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        { name: "Solana", desc: "L1 Settlement" },
                        { name: "Anchor", desc: "Program Framework" },
                        { name: "MagicBlock", desc: "Private ER Engine" },
                        { name: "Intel TDX", desc: "Hardware TEE" },
                        { name: "Next.js", desc: "Frontend" },
                        { name: "Phantom", desc: "Wallet Adapter" },
                        { name: "Borsh", desc: "Serialization" },
                        { name: "Rust", desc: "On-chain Program" },
                      ].map((t) => (
                        <div key={t.name} className="bg-gray-800 rounded-lg p-2.5 border border-gray-700 text-center">
                          <div className="font-semibold text-white text-sm">{t.name}</div>
                          <div className="text-[10px] text-gray-500">{t.desc}</div>
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
            <div className="mt-8 bg-gray-900 rounded-xl border border-teal-800 p-5 text-center">
              <div className="text-xs text-teal-500 uppercase tracking-wider font-semibold mb-1">Built for</div>
              <div className="text-lg font-bold text-white">MagicBlock Solana Blitz Hackathon V2</div>
              <div className="text-sm text-gray-400">March 2026 — Private Ephemeral Rollups Track</div>
              <div className="mt-2 text-xs text-gray-500">
                Program ID: <span className="font-mono text-gray-400">5bnJuoZoBWCURr3hh3qYsBiD9jiQiL5vbMXTJS5VFXVy</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
