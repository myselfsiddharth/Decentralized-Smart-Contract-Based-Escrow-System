import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, Interface, formatEther, getAddress, parseEther } from "ethers";
import EscrowFactoryArtifact from "./abis/EscrowFactory.json";
import EscrowArtifact from "./abis/Escrow.json";
import {
  connectWallet,
  ensureChain,
  getEthereum,
  revokeWalletAccess,
} from "./wallet.js";
import {
  getRecentEscrows,
  loadPrefs,
  rememberRecentEscrow,
  savePrefs,
} from "./storage.js";
import { formatContractError } from "./errors.js";
import { finalizeGasOverrides } from "./gas.js";
import { CHAIN_META, resolveConfiguredChainId } from "./chains.js";
import {
  buildLoginMessage,
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from "./authSession.js";
import "./App.css";

const STATUS_LABELS = [
  "Created",
  "Funded",
  "Completed",
  "Approved",
  "Refunded",
];

const defaultFreelancer =
  import.meta.env.VITE_DEFAULT_FREELANCER?.trim?.() || "";

const CHAIN_ID = resolveConfiguredChainId(import.meta.env.VITE_CHAIN_ID);
const CHAIN = CHAIN_META[CHAIN_ID];
const CHAIN_NAME = CHAIN.chainName;
const CHAIN_LABEL = `${CHAIN_NAME} (chain ${CHAIN_ID})`;
const CHAIN_NATIVE_SYMBOL = CHAIN.nativeCurrency.symbol;

/** Trim, strip wrapping quotes, add 0x if user pasted 40 hex chars only. */
function normalizeHexAddress(s) {
  if (s == null) return "";
  let t = String(s).trim();
  t = t.replace(/^["']+|["']+$/g, "");
  if (/^[a-fA-F0-9]{40}$/.test(t)) t = `0x${t}`;
  return t;
}

function isAddress(s) {
  return /^0x[a-fA-F0-9]{40}$/.test(normalizeHexAddress(s));
}

/** Compare on-chain / MetaMask addresses (checksum-safe). */
function sameAddress(a, b) {
  if (a == null || b == null) return false;
  const as = String(a).trim();
  const bs = String(b).trim();
  if (!as || !bs) return false;
  try {
    return getAddress(as) === getAddress(bs);
  } catch {
    return as.toLowerCase() === bs.toLowerCase();
  }
}

/** Ethers may return uint enums as number or bigint depending on ABI path. */
function normalizeContractStatus(st) {
  if (st == null) return null;
  if (typeof st === "bigint") return Number(st);
  const n = Number(st);
  return Number.isFinite(n) ? n : null;
}

function parseEscrowDeployedAddress(receipt, factoryAddress) {
  const iface = new Interface(EscrowFactoryArtifact.abi);
  const fa = factoryAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== fa) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "EscrowDeployed") {
        return String(parsed.args.escrow);
      }
    } catch {
      /* not this event */
    }
  }
  return null;
}

function nextStepHint(viewStatus, isClient, isFreelancer, appRole) {
  if (appRole !== "client" && appRole !== "freelancer") return "";
  if (appRole === "freelancer") {
    if (viewStatus == null)
      return "Enter the escrow address the client gave you, then tap Refresh state.";
    if (viewStatus === 0)
      return "Waiting for the client to deposit POL — you’ll submit work when status is Funded.";
    if (viewStatus === 1) {
      if (isFreelancer)
        return "Escrow is funded — add your proof link/CID and submit work.";
      return "Switch MetaMask to your freelancer address (the one locked in this escrow), then submit.";
    }
    if (viewStatus === 2) return "Work is submitted — the client will approve or request a refund.";
    if (viewStatus === 3) return "This escrow is approved and paid out.";
    if (viewStatus === 4) return "This escrow was refunded to the client.";
    return "";
  }
  if (viewStatus == null)
    return "Create an escrow or paste an address from your freelancer, then refresh state.";
  if (viewStatus === 0) {
    if (isClient)
      return "You are the client — click Deposit and confirm in MetaMask (exact POL amount).";
    return "Switch MetaMask to the client wallet, then click Deposit.";
  }
  if (viewStatus === 1) {
    if (isFreelancer)
      return "Funds are locked — your freelancer will submit proof from their dashboard.";
    return "Funds are in escrow — the freelancer submits work next.";
  }
  if (viewStatus === 2) {
    if (isClient)
      return "Work submitted — choose Approve (pay freelancer) or Reject & refund.";
    return "Waiting for the client to approve or reject.";
  }
  if (viewStatus === 3) return "This escrow is approved and paid out.";
  if (viewStatus === 4) return "This escrow was refunded to the client.";
  return "";
}

export default function App() {
  const prefs = loadPrefs();
  const recentInitial = getRecentEscrows();

  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageKind, setMessageKind] = useState("ok");

  const factoryChecksum = useMemo(() => {
    const t = normalizeHexAddress(
      import.meta.env.VITE_FACTORY_ADDRESS?.trim?.() || ""
    );
    if (!isAddress(t)) return "";
    try {
      return getAddress(t);
    } catch {
      return "";
    }
  }, []);
  const factoryConfigured = Boolean(factoryChecksum);

  const [authenticated, setAuthenticated] = useState(false);
  const [appRole, setAppRole] = useState(() =>
    prefs.appRole === "client" || prefs.appRole === "freelancer"
      ? prefs.appRole
      : null
  );

  const [createClient, setCreateClient] = useState(
    () => (prefs.createClient || "").trim()
  );
  const [createFreelancer, setCreateFreelancer] = useState(() =>
    (defaultFreelancer || prefs.createFreelancer || "").trim()
  );
  const [createAmountPol, setCreateAmountPol] = useState(
    () => String(prefs.createAmountPol ?? "0.001")
  );

  const [escrowAddress, setEscrowAddress] = useState(
    () => (prefs.escrowAddress || "").trim()
  );
  const [workReference, setWorkReference] = useState(
    () => prefs.workReference || "ipfs://work-proof-cid"
  );

  const [viewClient, setViewClient] = useState("");
  const [viewFreelancer, setViewFreelancer] = useState("");
  const [viewAmount, setViewAmount] = useState("");
  const [viewStatus, setViewStatus] = useState(null);
  const [viewWorkRef, setViewWorkRef] = useState("");

  const [recentEscrows, setRecentEscrows] = useState(recentInitial);
  const prevAccountRef = useRef("");
  const escrowAddressRef = useRef(escrowAddress);
  escrowAddressRef.current = escrowAddress;

  const showFlash = useCallback((kind, text) => {
    setMessageKind(kind);
    setMessage(text);
  }, []);

  const refreshChainAndAccount = useCallback(async (prov) => {
    const net = await prov.getNetwork();
    setChainId(Number(net.chainId));
    const sig = await prov.getSigner();
    setSigner(sig);
    const addr = await sig.getAddress();
    setAccount(addr);
  }, []);

  const loadEscrow = useCallback(
    async (addressOverride, options = {}) => {
      const silent = Boolean(options.silent);
      const addr = (addressOverride ?? escrowAddress).trim();
      if (!provider || !addr) {
        if (!silent)
          showFlash("warn", "Connect wallet and enter an escrow address.");
        return;
      }
      if (!isAddress(addr)) {
        if (!silent) showFlash("warn", "Enter a valid escrow address (0x + 40 hex).");
        return;
      }
      if (!silent) setBusy(true);
      try {
        const ro = new Contract(addr, EscrowArtifact.abi, provider);
        const [c, f, amt, st, wr] = await Promise.all([
          ro.client(),
          ro.freelancer(),
          ro.amount(),
          ro.status(),
          ro.workReference(),
        ]);
        if (escrowAddressRef.current.trim() !== addr) return;
        const stNum = normalizeContractStatus(st);
        if (stNum == null) {
          throw new Error("Could not read escrow status from contract.");
        }
        setViewClient(c);
        setViewFreelancer(f);
        setViewAmount(formatEther(amt));
        setViewStatus(stNum);
        const wrs = String(wr);
        setViewWorkRef(wrs);
        if (wrs.length > 0) setWorkReference(wrs);
        if (!silent) showFlash("ok", "Escrow state loaded.");
      } catch (e) {
        if (escrowAddressRef.current.trim() === addr) {
          setViewClient("");
          setViewFreelancer("");
          setViewAmount("");
          setViewStatus(null);
          setViewWorkRef("");
        }
        if (!silent) showFlash("err", e?.shortMessage || e?.message || String(e));
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [provider, escrowAddress, showFlash]
  );

  useEffect(() => {
    savePrefs({
      escrowAddress,
      createAmountPol,
      workReference,
      createClient,
      createFreelancer,
      appRole,
    });
  }, [
    escrowAddress,
    createAmountPol,
    workReference,
    createClient,
    createFreelancer,
    appRole,
  ]);

  useEffect(() => {
    if (!account) {
      prevAccountRef.current = "";
      return;
    }
    if (!prevAccountRef.current) {
      setCreateClient((c) => (c.trim() ? c : account));
    }
    prevAccountRef.current = account;
  }, [account]);

  useEffect(() => {
    if (!provider || !escrowAddress.trim() || !isAddress(escrowAddress)) return;
    const addr = escrowAddress.trim();
    const t = setTimeout(() => {
      loadEscrow(addr, { silent: true }).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [escrowAddress, provider, loadEscrow]);

  const signIn = async () => {
    setBusy(true);
    setMessage(null);
    clearAuthSession();
    try {
      const prov = await connectWallet();
      await ensureChain(CHAIN_ID);
      setProvider(prov);
      await refreshChainAndAccount(prov);
      const sig = await prov.getSigner();
      const addr = await sig.getAddress();
      const loginMessage = buildLoginMessage(addr, CHAIN_ID);
      const signature = await sig.signMessage(loginMessage);
      saveAuthSession({
        address: addr,
        chainId: CHAIN_ID,
        message: loginMessage,
        signature,
      });
      setAuthenticated(true);
      setAppRole(null);
      savePrefs({ appRole: null });
      showFlash(
        "ok",
        "Signed in with your wallet. Next, say whether you are the client or the freelancer."
      );
    } catch (e) {
      const msg = String(e?.message || e?.shortMessage || e || "");
      if (e?.code === 4001 || /user rejected|denied|reject/i.test(msg)) {
        showFlash(
          "warn",
          "Sign-in was cancelled. Approve the connection and the signature in your wallet to continue."
        );
      } else {
        showFlash("err", msg || String(e));
      }
      setProvider(null);
      setSigner(null);
      setAccount("");
      setChainId(null);
      prevAccountRef.current = "";
    } finally {
      setBusy(false);
    }
  };

  const resumeSession = async () => {
    const session = loadAuthSession();
    if (!session?.address) {
      showFlash("warn", "No saved session. Use Sign in instead.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const prov = await connectWallet();
      await ensureChain(CHAIN_ID);
      const sig0 = await prov.getSigner();
      const addr = await sig0.getAddress();
      if (addr.toLowerCase() !== session.address.toLowerCase()) {
        clearAuthSession();
        setProvider(null);
        setSigner(null);
        setAccount("");
        setChainId(null);
        showFlash(
          "warn",
          "Active wallet does not match your saved session. Sign in again with the same account."
        );
        return;
      }
      setProvider(prov);
      await refreshChainAndAccount(prov);
      setAuthenticated(true);
      showFlash("ok", "Welcome back — your wallet matches this session.");
    } catch (e) {
      showFlash("err", e?.shortMessage || e?.message || String(e));
      setProvider(null);
      setSigner(null);
      setAccount("");
      setChainId(null);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await revokeWalletAccess();
    } finally {
      clearAuthSession();
      setAuthenticated(false);
      setAppRole(null);
      setProvider(null);
      setSigner(null);
      setAccount("");
      setChainId(null);
      prevAccountRef.current = "";
      savePrefs({ appRole: null });
      showFlash("ok", "Signed out. Sign in again when you return.");
      setBusy(false);
    }
  };

  const chooseRole = (role) => {
    setAppRole(role);
    savePrefs({ appRole: role });
    showFlash("ok", role === "client" ? "Showing client tools." : "Showing freelancer tools.");
  };

  const backToRolePicker = () => {
    setAppRole(null);
    savePrefs({ appRole: null });
  };

  const pickRecentEscrow = (value) => {
    setEscrowAddress(value);
    if (provider && isAddress(value)) loadEscrow(value.trim(), { silent: true });
  };

  const createEscrowTx = async () => {
    if (!signer || !factoryChecksum) {
      showFlash(
        "warn",
        "Factory is missing. Set VITE_FACTORY_ADDRESS in frontend/.env and restart the dev server."
      );
      return;
    }
    const fac = factoryChecksum;
    const clientAddr = normalizeHexAddress(createClient.trim() || account);
    const freeAddr = normalizeHexAddress(createFreelancer);
    if (!isAddress(clientAddr) || !isAddress(freeAddr)) {
      showFlash("warn", "Enter valid client and freelancer addresses (0x + 40 hex).");
      return;
    }
    if (clientAddr.toLowerCase() === freeAddr.toLowerCase()) {
      showFlash("warn", "Client and freelancer must be different wallets.");
      return;
    }
    let clientCk;
    let freeCk;
    let facCk;
    try {
      clientCk = getAddress(clientAddr);
      freeCk = getAddress(freeAddr);
      facCk = getAddress(fac);
    } catch (e) {
      showFlash("err", formatContractError(e));
      return;
    }
    setBusy(true);
    try {
      const net = await signer.provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) {
        showFlash(
          "err",
          `This app is configured for ${CHAIN_LABEL}. Switch the active network in MetaMask to ${CHAIN_NAME}.`
        );
        setBusy(false);
        return;
      }

      const bytecode = await signer.provider.getCode(facCk);
      if (!bytecode || bytecode === "0x") {
        showFlash(
          "err",
          `No contract at factory ${facCk} on chain ${CHAIN_ID}. Deploy the factory on this network or paste the correct address.`
        );
        setBusy(false);
        return;
      }

      const factory = new Contract(facCk, EscrowFactoryArtifact.abi, signer);
      const amountWei = parseEther(createAmountPol || "0");
      if (amountWei <= 0n) {
        showFlash("warn", "Amount must be greater than zero.");
        setBusy(false);
        return;
      }

      const txOpts = await finalizeGasOverrides(
        signer.provider,
        CHAIN_ID,
        (hints) =>
          factory.createEscrow.estimateGas(clientCk, freeCk, amountWei, hints),
        { cap: 4_500_000n, fallback: 3_200_000n, floor: 500_000n }
      );

      await factory.createEscrow.staticCall(clientCk, freeCk, amountWei, txOpts);

      const tx = await factory.createEscrow(clientCk, freeCk, amountWei, txOpts);
      showFlash("ok", `Create escrow tx sent: ${tx.hash}`);
      const receipt = await tx.wait();
      const deployed = parseEscrowDeployedAddress(receipt, facCk);
      if (deployed) {
        setEscrowAddress(deployed);
        rememberRecentEscrow(deployed);
        setRecentEscrows(getRecentEscrows());
        showFlash("ok", `Escrow created at ${deployed}`);
        await loadEscrow(deployed, { silent: true });
        showFlash("ok", `Escrow ready — ${deployed.slice(0, 10)}…`);
      } else {
        showFlash(
          "warn",
          "Tx confirmed but EscrowDeployed not found. Check factory address on a block explorer."
        );
      }
    } catch (e) {
      showFlash("err", formatContractError(e));
    } finally {
      setBusy(false);
    }
  };

  const depositFundsTx = async () => {
    if (!signer || !escrowAddress.trim()) return;
    setBusy(true);
    try {
      const esc = new Contract(escrowAddress.trim(), EscrowArtifact.abi, signer);
      const amt = await esc.amount();
      const txOpts = await finalizeGasOverrides(
        signer.provider,
        CHAIN_ID,
        (hints) => esc.depositFunds.estimateGas({ value: amt, ...hints }),
        { cap: 450_000n, fallback: 300_000n, floor: 100_000n }
      );
      const tx = await esc.depositFunds({ value: amt, ...txOpts });
      showFlash("ok", `Deposit tx: ${tx.hash}`);
      await tx.wait();
      await loadEscrow(undefined, { silent: true });
      showFlash("ok", "Deposit confirmed.");
    } catch (e) {
      showFlash("err", formatContractError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitWorkTx = async () => {
    if (!signer || !escrowAddress.trim()) return;
    setBusy(true);
    try {
      const esc = new Contract(escrowAddress.trim(), EscrowArtifact.abi, signer);
      const wr = workReference.trim();
      if (!wr) {
        showFlash("warn", "Enter a work reference (IPFS CID or link).");
        setBusy(false);
        return;
      }
      const txOpts = await finalizeGasOverrides(
        signer.provider,
        CHAIN_ID,
        (hints) => esc.submitWork.estimateGas(wr, hints),
        { cap: 500_000n, fallback: 350_000n, floor: 120_000n }
      );
      const tx = await esc.submitWork(wr, txOpts);
      showFlash("ok", `Submit work tx: ${tx.hash}`);
      await tx.wait();
      await loadEscrow(undefined, { silent: true });
      showFlash("ok", "Work submitted.");
    } catch (e) {
      showFlash("err", formatContractError(e));
    } finally {
      setBusy(false);
    }
  };

  const approveWorkTx = async () => {
    if (!signer || !escrowAddress.trim()) return;
    setBusy(true);
    try {
      const esc = new Contract(escrowAddress.trim(), EscrowArtifact.abi, signer);
      const txOpts = await finalizeGasOverrides(
        signer.provider,
        CHAIN_ID,
        (hints) => esc.approveWork.estimateGas(hints),
        { cap: 400_000n, fallback: 280_000n, floor: 90_000n }
      );
      const tx = await esc.approveWork(txOpts);
      showFlash("ok", `Approve tx: ${tx.hash}`);
      await tx.wait();
      await loadEscrow(undefined, { silent: true });
      showFlash("ok", "Approved — funds sent to freelancer.");
    } catch (e) {
      showFlash("err", formatContractError(e));
    } finally {
      setBusy(false);
    }
  };

  const rejectWorkTx = async () => {
    if (!signer || !escrowAddress.trim()) return;
    setBusy(true);
    try {
      const esc = new Contract(escrowAddress.trim(), EscrowArtifact.abi, signer);
      const txOpts = await finalizeGasOverrides(
        signer.provider,
        CHAIN_ID,
        (hints) => esc.rejectWork.estimateGas(hints),
        { cap: 400_000n, fallback: 280_000n, floor: 90_000n }
      );
      const tx = await esc.rejectWork(txOpts);
      showFlash("ok", `Reject / refund tx: ${tx.hash}`);
      await tx.wait();
      await loadEscrow(undefined, { silent: true });
      showFlash("ok", "Rejected — refund sent to client.");
    } catch (e) {
      showFlash("err", formatContractError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const eth = getEthereum();
    if (!eth) return;

    const onAccounts = (accs) => {
      const session = loadAuthSession();
      if (accs?.length) {
        const next = accs[0];
        if (
          session &&
          authenticated &&
          next.toLowerCase() !== session.address.toLowerCase()
        ) {
          clearAuthSession();
          setAuthenticated(false);
          setAppRole(null);
          try {
            savePrefs({ appRole: null });
          } catch {
            /* ignore */
          }
        }
        setAccount(next);
        if (provider) {
          refreshChainAndAccount(provider).catch(() => {});
        }
      } else {
        clearAuthSession();
        setAuthenticated(false);
        setAppRole(null);
        try {
          savePrefs({ appRole: null });
        } catch {
          /* ignore */
        }
        setAccount("");
        setSigner(null);
        setProvider(null);
        setChainId(null);
        prevAccountRef.current = "";
      }
    };
    const onChain = async () => {
      if (provider) {
        try {
          await refreshChainAndAccount(provider);
        } catch {
          /* ignore */
        }
      }
    };

    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [provider, refreshChainAndAccount, authenticated]);

  const wrongChain = chainId != null && chainId !== CHAIN_ID;

  const isClient = useMemo(() => {
    return sameAddress(account, viewClient);
  }, [account, viewClient]);

  const isFreelancer = useMemo(() => {
    return sameAddress(account, viewFreelancer);
  }, [account, viewFreelancer]);

  const canDeposit =
    appRole === "client" &&
    !wrongChain &&
    viewStatus === 0 &&
    isClient &&
    escrowAddress.trim();
  const canSubmit =
    appRole === "freelancer" &&
    !wrongChain &&
    viewStatus === 1 &&
    isFreelancer &&
    escrowAddress.trim();
  const canApproveReject =
    appRole === "client" &&
    !wrongChain &&
    viewStatus === 2 &&
    isClient &&
    escrowAddress.trim();

  const walletRole =
    !account || viewStatus == null
      ? null
      : isClient
        ? "client"
        : isFreelancer
          ? "freelancer"
          : "neither";

  const actionButtonExplanations = [];
  if (!escrowAddress.trim()) {
    actionButtonExplanations.push(
      appRole === "freelancer"
        ? "Paste the escrow address the client sent you, then refresh."
        : "Paste an escrow address (from Create escrow or your freelancer), then refresh."
    );
  } else if (!provider) {
    actionButtonExplanations.push("Connect your wallet first.");
  } else if (wrongChain) {
    actionButtonExplanations.push(
      `Use ${CHAIN_LABEL} in MetaMask - switch the active network in your wallet.`
    );
  } else if (viewStatus == null) {
    actionButtonExplanations.push(
      "Tap “Refresh state” so the app can read status, client, and freelancer from the contract."
    );
  } else if (viewStatus >= 3) {
    actionButtonExplanations.push(
      "This escrow is already Approved or Refunded — no further actions."
    );
  } else if (appRole === "freelancer" && viewStatus === 0) {
    actionButtonExplanations.push(
      "The escrow is not funded yet. Ask the client to deposit; Submit work appears here once status is Funded."
    );
  } else if (appRole === "client" && viewStatus === 0 && !isClient) {
    actionButtonExplanations.push(
      `Status is “Created” — only the client (${viewClient?.slice(0, 10)}…) can Deposit. Switch MetaMask to that account.`
    );
  } else if (appRole === "freelancer" && viewStatus === 1 && !isFreelancer) {
    actionButtonExplanations.push(
      `Status is “Funded” — only the on-chain freelancer (${viewFreelancer?.slice(0, 10)}…) can submit. Switch to the wallet that was set as freelancer when this job was created.`
    );
  } else if (appRole === "client" && viewStatus === 1) {
    actionButtonExplanations.push(
      "Funds are locked. Your freelancer submits deliverables from their dashboard — you’ll approve or request a refund after."
    );
  } else if (appRole === "client" && viewStatus === 2 && !isClient) {
    actionButtonExplanations.push(
      `Work was submitted — switch MetaMask to the client (${viewClient?.slice(0, 10)}…) to Approve or Reject.`
    );
  } else if (
    appRole === "freelancer" &&
    viewStatus === 2 &&
    !isFreelancer &&
    viewClient
  ) {
    actionButtonExplanations.push(
      "Work is in review — only the client can approve or refund. You can disconnect and let them finish."
    );
  } else if (
    viewStatus != null &&
    account &&
    !isClient &&
    !isFreelancer &&
    viewClient
  ) {
    actionButtonExplanations.push(
      "This wallet is not the client or freelancer on this escrow — switch to one of the addresses shown above."
    );
  }

  const hint = nextStepHint(viewStatus, isClient, isFreelancer, appRole);

  const createEscrowBlockers = [];
  if (busy) createEscrowBlockers.push("Finish the current action first.");
  if (!account) createEscrowBlockers.push("Connect your wallet.");
  if (wrongChain)
    createEscrowBlockers.push(
      `Switch MetaMask to ${CHAIN_LABEL}.`
    );
  if (!factoryConfigured) {
    createEscrowBlockers.push(
      "Set a valid EscrowFactory in frontend/.env as VITE_FACTORY_ADDRESS, then restart npm run dev."
    );
  }

  const createEscrowDisabled =
    busy || wrongChain || !account || !factoryConfigured;

  const savedSession = loadAuthSession();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__top">
          <div className="app-logo" aria-hidden="true" />
          <span className="app-pill">
            {CHAIN_NAME} - {CHAIN.networkType}
          </span>
        </div>
        <h1>Escrow</h1>
        <p className="subtitle">
          Hold POL in trust on-chain until work is approved or refunded — built
          for clients and freelancers, with clear steps at every stage.
        </p>
      </header>

      <main className="app-main">
      {message && (
        <div
          className={`flash flash-${
            messageKind === "err" ? "err" : messageKind === "warn" ? "warn" : "ok"
          }`}
          role={messageKind === "err" ? "alert" : "status"}
        >
          {message}
        </div>
      )}

      {!authenticated && (
        <div className="auth-panel">
          <div className="auth-panel-inner">
            <h2 className="auth-title">Sign in</h2>
            <p className="auth-lead">
              We use your crypto wallet, no username or password on our servers. After you
              connect, you’ll be asked to sign a short message (standard for dapps) to prove
              you control this address.
            </p>
            <p className="auth-network-note">
              Network: <strong>{CHAIN_NAME}</strong> (chain {CHAIN_ID})
            </p>
            <div className="auth-actions">
              <button
                type="button"
                className="btn btn-primary btn-auth"
                onClick={signIn}
                disabled={busy || !getEthereum()}
              >
                {busy ? "Waiting for wallet…" : "Sign in with Ethereum"}
              </button>
              {savedSession?.address && (
                <button
                  type="button"
                  className="btn btn-secondary btn-auth"
                  onClick={resumeSession}
                  disabled={busy || !getEthereum()}
                >
                  Resume session ({savedSession.address.slice(0, 6)}…
                  {savedSession.address.slice(-4)})
                </button>
              )}
            </div>
            {!getEthereum() && (
              <p className="hint hint-warn">
                Install a browser wallet (e.g. MetaMask) to continue.
              </p>
            )}
            <p className="auth-footnote">
              Signing out clears this tab’s session. Your escrow drafts are still saved in this
              browser.
            </p>
          </div>
        </div>
      )}

      {authenticated && !appRole && (
        <div className="role-panel">
          <h2 className="role-title">Who are you?</h2>
          <p className="role-lead">
            We’ll only show buttons that match your role. You can switch anytime with{" "}
            <strong>Change role</strong> — no need to sign out.
          </p>
          <div className="role-cards">
            <button
              type="button"
              className="role-card role-card--client"
              onClick={() => chooseRole("client")}
              disabled={busy}
            >
              <span className="role-card-icon" aria-hidden="true">
                💼
              </span>
              <span className="role-card-label">I’m the client</span>
              <span className="role-card-desc">
                Open an escrow, deposit POL, then approve payout or request a refund.
              </span>
            </button>
            <button
              type="button"
              className="role-card role-card--freelancer"
              onClick={() => chooseRole("freelancer")}
              disabled={busy}
            >
              <span className="role-card-icon" aria-hidden="true">
                🛠️
              </span>
              <span className="role-card-label">I’m the freelancer</span>
              <span className="role-card-desc">
                Paste the escrow address from your client and submit your deliverable proof.
              </span>
            </button>
          </div>
        </div>
      )}

      {authenticated && appRole && (
        <>
          <div className="next-step" role="status">
            <strong>What to do next</strong>
            <p className="next-step-text">{hint}</p>
          </div>

          <div className="panel panel-session">
            <div className="session-bar">
              <span className="session-badge">
                {appRole === "client" ? "Client mode" : "Freelancer mode"}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={backToRolePicker}
                disabled={busy}
              >
                Change role
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={disconnect}
                disabled={busy}
              >
                Sign out
              </button>
            </div>
            <p className="metamask-hint session-account">
              <strong>{account}</strong>
              {chainId != null && (
                <>
                  {" "}
                  ·{" "}
                  {wrongChain ? (
                    <span className="session-warn">
                      wrong network ({chainId}) - switch to {CHAIN_NAME} ({CHAIN_ID}) in MetaMask
                    </span>
                  ) : (
                    <>{CHAIN_NAME} ({chainId})</>
                  )}
                </>
              )}
            </p>
          </div>

          {appRole === "client" && !factoryConfigured && (
            <div className="panel panel-warn">
              <h2>Factory not configured</h2>
              <p className="hint">
                Add a valid <code>VITE_FACTORY_ADDRESS</code> to{" "}
                <code>frontend/.env</code>, then restart <code>npm run dev</code>. The app no
                longer accepts a factory address in the UI.
              </p>
            </div>
          )}

          {appRole === "client" && (
            <div className="panel">
              <div className="panel-heading-row">
                <h2>Create escrow</h2>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={backToRolePicker}
                  disabled={busy}
                >
                  Change role
                </button>
              </div>
        <div className="row row-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={!account}
            onClick={() => account && setCreateClient(account)}
          >
            My wallet → client
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={!account}
            onClick={() => account && setCreateFreelancer(account)}
          >
            My wallet → freelancer
          </button>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="cclient">Client address</label>
            <input
              id="cclient"
              type="text"
              spellCheck={false}
              placeholder="Autofilled on first connect"
              value={createClient}
              onChange={(e) => setCreateClient(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cfree">Freelancer address</label>
            <input
              id="cfree"
              type="text"
              spellCheck={false}
              placeholder="Other party or use VITE_DEFAULT_FREELANCER"
              value={createFreelancer}
              onChange={(e) => setCreateFreelancer(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="camt">Amount (POL)</label>
            <input
              id="camt"
              type="text"
              inputMode="decimal"
              value={createAmountPol}
              onChange={(e) => setCreateAmountPol(e.target.value)}
            />
          </div>
        </div>
        <p className="hint">
          This amount is what you will lock in the escrow when the client deposits
          {" - "}
          {CHAIN_ID === 80002
            ? "it is not the network fee. Gas is separate; on Amoy the chain requires about a 25 gwei priority fee minimum, so MetaMask may show a higher fee than on mainnet Ethereum even for small escrows."
            : `it is not the network fee. Gas is separate and paid in ${CHAIN_NATIVE_SYMBOL} on ${CHAIN_NAME}.`}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={createEscrowDisabled}
          onClick={createEscrowTx}
        >
          Create escrow
        </button>
        {createEscrowDisabled && createEscrowBlockers.length > 0 && (
          <ul className="blocker-list">
            {createEscrowBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <p className="hint">
          Any wallet can pay gas to create. The client must deposit the exact POL
          amount later; use two different MetaMask accounts for a realistic demo.
        </p>
      </div>
          )}

      <div className="panel">
        <div className="panel-heading-row">
          <h2>Escrow</h2>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={backToRolePicker}
            disabled={busy}
          >
            Change role
          </button>
        </div>
        {recentEscrows.length > 0 && (
          <div className="row">
            <div className="field">
              <label htmlFor="recent">Recent escrows (this browser)</label>
              <select
                id="recent"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) pickRecentEscrow(v);
                  e.target.value = "";
                }}
              >
                <option value="">Select to autofill address…</option>
                {recentEscrows.map((x) => (
                  <option key={x} value={x}>
                    {x.slice(0, 10)}…{x.slice(-8)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="row">
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor="escrow">Escrow contract address</label>
            <input
              id="escrow"
              type="text"
              spellCheck={false}
              placeholder={
                appRole === "freelancer"
                  ? "Paste the address your client shares with you"
                  : "Set after Create escrow or paste from your freelancer"
              }
              value={escrowAddress}
              onChange={(e) => setEscrowAddress(e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-outline"
            disabled={busy || !escrowAddress.trim()}
            onClick={() => loadEscrow()}
          >
            Refresh state
          </button>
        </div>
        {viewStatus != null ? (
          <div className="status-card">
            <div className="status-grid">
              <div className="status-line">
                <span className="status-k">Status</span>
                <span className="status-v">
                  <strong>{STATUS_LABELS[viewStatus] ?? viewStatus}</strong>
                </span>
              </div>
              <div className="status-line">
                <span className="status-k">Client</span>
                <span className="status-v">{viewClient}</span>
              </div>
              <div className="status-line">
                <span className="status-k">Freelancer</span>
                <span className="status-v">{viewFreelancer}</span>
              </div>
              <div className="status-line">
                <span className="status-k">Amount</span>
                <span className="status-v">{viewAmount} POL</span>
              </div>
              <div className="status-line">
                <span className="status-k">Work reference</span>
                <span className="status-v">{viewWorkRef || "—"}</span>
              </div>
              {account && (
                <div className="status-line status-line--wide">
                  <span className="status-k">Your wallet on this escrow</span>
                  <span className="status-v">
                    <strong>
                      {walletRole === "client"
                        ? "Client — you can deposit, approve, or reject when the contract allows"
                        : walletRole === "freelancer"
                          ? "Freelancer — you can submit work when funded"
                          : walletRole === "neither"
                            ? "Neither party — switch MetaMask to the client or freelancer address"
                            : "—"}
                    </strong>
                  </span>
                </div>
              )}
              {appRole === "freelancer" &&
                viewStatus === 1 &&
                account &&
                viewFreelancer && (
                  <p className="status-line status-line--wide hint-match">
                    <span className="status-k">Funded check</span>
                    <span className="status-v">
                      Your wallet {isFreelancer ? "matches" : "does not match"} the
                      on-chain freelancer{" "}
                      <code className="addr-chip">{viewFreelancer}</code>.
                    </span>
                  </p>
                )}
            </div>
          </div>
        ) : (
          escrowAddress.trim() &&
          provider && (
            <p className="hint hint-warn">
              Escrow state not loaded yet. Click <strong>Refresh state</strong> to
              read the contract; buttons stay disabled until then.
            </p>
          )
        )}

        {actionButtonExplanations.length > 0 &&
          !canDeposit &&
          !canSubmit &&
          !canApproveReject && (
            <div className="actions-help">
              <strong>Why actions are disabled</strong>
              <ul>
                {actionButtonExplanations.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}

        {appRole === "freelancer" && (
          <div className="row" style={{ marginTop: "1rem" }}>
            <div className="field" style={{ flex: "1 1 100%" }}>
              <label htmlFor="work">Work reference (IPFS CID / link)</label>
              <input
                id="work"
                type="text"
                spellCheck={false}
                value={workReference}
                onChange={(e) => setWorkReference(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="row row-actions">
          {appRole === "client" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !canDeposit}
                onClick={depositFundsTx}
              >
                Deposit
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !canApproveReject}
                onClick={approveWorkTx}
              >
                Approve & pay
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || !canApproveReject}
                onClick={rejectWorkTx}
              >
                Reject & refund
              </button>
            </>
          )}
          {appRole === "freelancer" && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !canSubmit}
              onClick={submitWorkTx}
            >
              Submit work
            </button>
          )}
        </div>
        <p className="hint">
          {appRole === "client"
            ? "Actions here are for the client path only. Use another browser profile or device for the freelancer wallet if you are testing both sides."
            : "Submit work only works when this escrow is Funded and your wallet is the freelancer on-chain. Ask the client to deposit first if status is still Created."}
        </p>
      </div>
        </>
      )}
      </main>
    </div>
  );
}
