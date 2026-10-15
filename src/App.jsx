"use client";
import React, { createContext, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText,
  Inbox, Mail, Menu, MoreHorizontal, Package, Plus, Search,
  LogOut, Settings, ShieldCheck, Sparkles, Users, X, Zap
} from "lucide-react";
import { DEFAULT_ORGANISATION } from "./tenant.js";
import { supabase } from "./lib/supabase.js";
import { customerStrategyStore, getCustomerStrategy } from "./domain/packData.js";
import { NavItem, Status } from "./components/SharedComponents.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { usePackWorkspace } from "./hooks/usePackWorkspace.js";
import { LocalTestLogin, SupabaseLogin, SupabasePasswordSetup } from "./components/pages/AuthPages.jsx";
import { UploadConfirmModal } from "./components/UploadConfirmModal.jsx";
import { usePackActions } from "./hooks/usePackActions.js";
import { findPackByUuid, packRoute, packUuidFromPath } from "./domain/routes.js";
import { ensurePackUuid } from "./domain/packData.js";
import { canOpenPack } from "./domain/packView.js";

export const WorkspaceContext=createContext(null);

export function useWorkspace(){
  const context=React.useContext(WorkspaceContext);
  if(!context)throw new Error("useWorkspace must be used within the application shell");
  return context;
}

function App({children}){
  const pathname=usePathname();
  const router=useRouter();
  const localTestRoute=process.env.NODE_ENV !== "production"&&typeof window!=="undefined"&&window.location.pathname==="/test-auth";
  const {authenticated,currentUser,passwordSetup,authError,setAuthenticated,setCurrentUser,setPasswordSetup}=useAuthSession({localTestRoute});
  const [agentOpen,setAgentOpen]=useState(true);
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const currentUserRole=currentUser?.role||"";
  const currentUserName=currentUser?.name||"";
  const currentUserInitials=currentUser?.initials||"";
  const canViewManager=currentUserRole==="manager" || currentUserRole==="admin";
  const [toast,setToast]=useState("");
  const [uploadCustomer,setUploadCustomer]=useState("Auto-detect customer");
  const [uploadCustomers,setUploadCustomers]=useState([]);
  const { livePacks, setLivePacks, dataSource, packsLoading, packLoadError, setPackLoadError, emailSyncStatus, persistPack } = usePackWorkspace({ authenticated });
  const uploadRef=useRef(null);
  const packUuid=packUuidFromPath(pathname);
  const selectedPack=useMemo(()=>findPackByUuid(livePacks,packUuid),[livePacks,packUuid]);
  const routePage=pathname==="/manager"?"manager":pathname==="/customers"?"customers":pathname==="/agent"?"agent":pathname==="/settings"?"settings":pathname?.startsWith("/inbox/")?"review":"inbox";
  const isReview=routePage==="review";
  const navigate=(target)=>{const routes={inbox:"/inbox",manager:"/manager",customers:"/customers",agent:"/agent",settings:"/settings"};router.push(routes[target]||"/inbox");setMobileMenuOpen(false);};
  const openPack=pack=>{if(!pack)return;if(!canOpenPack(pack)){notify("This pack is still processing. It will become available when extraction completes.");return;}router.push(packRoute(ensurePackUuid(pack)));setMobileMenuOpen(false);};
  const notify=(msg)=>{setToast(msg);setTimeout(()=>setToast(""),2500)};

  const loadUploadCustomers=async()=>{
    try{
      const response=await fetch("/api/organisation?action=customers",{credentials:"include"});
      const data=await response.json().catch(()=>({}));
      if(response.ok&&Array.isArray(data.customers)){
        setUploadCustomers(data.customers);
      }
    }catch{}
  };

  const recordHistory=async(pack,action,description,beforeData=null,afterData=null,metadata=null,actorType="user",actorName=null)=>{if(!pack?.id)return;try{await fetch("/api/history",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({packId:pack.id,action,description,beforeData,afterData,metadata,actorType,actorName})});}catch{}};

  const {
    pendingUploadFiles,
    setPendingUploadFiles,
    showUploadConfirm,
    setShowUploadConfirm,
    handleUpload,
    confirmUpload,
    reprocessPack,
    deletePack,
    assignPack,
    updatePack,
    persistValidatedPack,
    validatePack,
    postToLCA
  } = usePackActions({
    currentUserName,
    currentOrganisationId:currentUser?.organisationId,
    livePacks,
    setLivePacks,
    selectedPack,
    persistPack,
    navigate,
    notify,
    recordHistory
  });



  React.useEffect(()=>{
    if(showUploadConfirm){
      loadUploadCustomers();
    }
  },[showUploadConfirm]);

  if(passwordSetup)return <SupabasePasswordSetup onComplete={user=>{setPasswordSetup(false);setCurrentUser(user);setAuthenticated(true);router.push("/inbox");}}/>;
  if(authenticated===null)return <div className="test-login"><div className="test-login-card"><div className="test-login-brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div><div className="test-login-copy"><div className="eyebrow">Secure access</div><h1>Checking access…</h1><p>Please wait.</p></div></div></div>;
  if(!authenticated)return localTestRoute ? <LocalTestLogin onSuccess={user=>{setCurrentUser(user);setAuthenticated(true);router.push("/inbox");}}/> : passwordSetup ? <SupabasePasswordSetup onComplete={user=>{setPasswordSetup(false);setCurrentUser(user);setAuthenticated(true);router.push("/inbox");}}/> : <SupabaseLogin initialError={authError} onSuccess={user=>{setCurrentUser(user);setAuthenticated(true);router.push("/inbox");}}/>;
  if(!currentUser)return <div className="test-login"><div className="test-login-card"><div className="test-login-copy"><div className="eyebrow">Account</div><h1>Loading profile…</h1><p>Loading your Customs IDP organisation access.</p></div></div></div>;

  const workspaceValue={currentUser,currentUserName,currentUserRole,canViewManager,livePacks,setLivePacks,dataSource,packsLoading,packLoadError,setPackLoadError,emailSyncStatus,persistPack,selectedPack,navigate,openPack,notify,handleUpload,deletePack,assignPack,updatePack,validatePack,postToLCA,reprocessPack,persistValidatedPack,recordHistory};
  const displayUserInitials=currentUserInitials||currentUserName.split(/\s+/).filter(Boolean).map(part=>part[0]).join("").slice(0,2).toUpperCase()||"U";

  return <WorkspaceContext.Provider value={workspaceValue}><div className={"app-shell "+(sidebarCollapsed?"sidebar-collapsed":"")}>
    <aside className="sidebar">
      <div className="sidebar-head"><div className="brand">{sidebarCollapsed?<button className="brand-mark sidebar-brand-toggle" type="button" aria-label="Expand navigation" title="Expand navigation" onClick={()=>setSidebarCollapsed(false)}><Zap className="brand-zap-icon" size={18}/><ChevronRight className="brand-expand-icon" size={18}/></button>:<div className="brand-mark"><Zap size={18}/></div>}<div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div>{!sidebarCollapsed&&<button className="sidebar-collapse-btn" type="button" aria-label="Collapse navigation" title="Collapse navigation" onClick={()=>setSidebarCollapsed(true)}><ChevronLeft size={16}/></button>}</div>
      <nav>
        <NavItem icon={Inbox} label="Inbox" badge={livePacks.length} active={routePage==="inbox"||isReview} onClick={()=>navigate("inbox")}/>
        {canViewManager && <NavItem icon={Activity} label="Manager" active={routePage==="manager"} onClick={()=>navigate("manager")}/>}
        <NavItem icon={Users} label="Customers" active={routePage==="customers"} onClick={()=>navigate("customers")}/>
        <NavItem icon={Bot} label="AI Agent" active={routePage==="agent"} onClick={()=>navigate("agent")}/>
      </nav>
      <div className="side-bottom">
        <div className="profile-control"><div className="workspace" aria-label={`${currentUserName||"Current user"} at ${DEFAULT_ORGANISATION.name}`} title={`${currentUserName||"Current user"} · ${DEFAULT_ORGANISATION.name}`}><div className="avatar" aria-hidden="true">{displayUserInitials}</div><div className="workspace-copy"><b className="workspace-user">{currentUserName}</b><span className="workspace-role">{currentUserRole==="manager"?"Manager":"Data Processor"}</span><small className="workspace-organisation">{DEFAULT_ORGANISATION.name}</small></div></div></div>
        <div className="side-utilities">
          <NavItem icon={Settings} label="Settings" active={routePage==="settings"} onClick={()=>navigate("settings")}/>
          <button className="sidebar-sign-out" type="button" title="Sign out" aria-label="Sign out" onClick={async()=>{await supabase.auth.signOut().catch(()=>{});await fetch("/api/auth",{method:"DELETE",credentials:"include"}).catch(()=>{});setCurrentUser(null);setAuthenticated(false);router.push("/inbox")}}><LogOut size={16}/><span>Sign out</span></button>
        </div>
        <div className="system-status"><span className="dot"></span><div><b>All systems operational</b><span>Last sync 16:02</span></div></div>
      </div>
    </aside>

    {mobileMenuOpen && <div className="mobile-menu-overlay" onClick={()=>setMobileMenuOpen(false)}><aside className="mobile-menu" onClick={e=>e.stopPropagation()}><div className="mobile-menu-head"><div className="brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div><button className="icon-btn" aria-label="Close navigation" onClick={()=>setMobileMenuOpen(false)}><X size={20}/></button></div><div className="mobile-workspace"><div className="avatar">{currentUserInitials}</div><div><b>{currentUserName}</b><span>{currentUserRole==="manager"?"Manager":"Data Processor"} · {dataSource==="database"?"Database connected":"Prototype storage"}</span></div></div><nav><NavItem icon={Inbox} label="Inbox" badge={livePacks.length} active={routePage==="inbox"||isReview} onClick={()=>navigate("inbox")}/>{canViewManager && <NavItem icon={Activity} label="Manager" active={routePage==="manager"} onClick={()=>navigate("manager")}/>}<NavItem icon={Users} label="Customers" active={routePage==="customers"} onClick={()=>navigate("customers")}/><NavItem icon={Bot} label="AI Agent" active={routePage==="agent"} onClick={()=>navigate("agent")}/><NavItem icon={Settings} label="Settings" active={routePage==="settings"} onClick={()=>navigate("settings")}/></nav><button className="switch-user-btn mobile-switch-user" onClick={()=>{setCurrentUser(null);try{localStorage.removeItem("customs-idp-user");}catch{};router.push("/inbox")}}><Users size={16}/><span>Switch user</span></button><div className="mobile-system-status"><span className="dot"></span><div><b>All systems operational</b><span>Last sync 16:02</span></div></div></aside></div>}

    <main className={"main "+(isReview?"review-mode":"")}>
      <header className="topbar">
        {isReview&&<div className="topbar-context"><button className="back-to-inbox-btn" aria-label="Back to inbox" title="Back to inbox" onClick={()=>navigate("inbox")}><ChevronLeft size={16}/><span>Back to inbox</span></button><Status status={selectedPack?.status}/></div>}
        <button className="mobile-menu-btn" aria-label="Open navigation" onClick={()=>setMobileMenuOpen(true)}><Menu size={20}/></button><div className="mobile-brand"><strong>Customs IDP</strong></div>
        {!isReview&&<div className="crumb"><span className="organisation-crumb">{DEFAULT_ORGANISATION.name}</span> <span>/</span> Operations <span>/</span> {routePage[0].toUpperCase()+routePage.slice(1)}</div>}
        <div className="top-actions">{isReview&&selectedPack&&<div className="review-top-actions"><select className="owner-select review-owner" aria-label="Assign document owner" value={selectedPack.assignedTo||"Unassigned"} onChange={e=>assignPack(selectedPack.id,e.target.value)}><option>Unassigned</option><option>Liam Wingrove</option><option>Data Processor 1</option><option>Data Processor 2</option><option>Muhammad Amer</option></select><button className="secondary" onClick={()=>reprocessPack?.(selectedPack)}>Re-process</button><button className="secondary" onClick={validatePack}>Validate data</button><button className="primary" onClick={postToLCA}>Post to LCA</button></div>}<button className="top-avatar top-user-button" aria-label={`Signed in as ${currentUserName||"current user"}`} title={currentUserName||"Current user"}>{displayUserInitials}</button></div>
      </header>

      <input ref={uploadRef} className="hidden-upload" type="file" multiple accept=".pdf,.xlsx,.xls,.doc,.docx,.csv,.png,.jpg,.jpeg,.eml,.msg" onChange={e=>handleUpload(e.target.files)}/>
      <div className="content">{children}</div>
    </main>

    {agentOpen && routePage!=="agent" && !isReview && <button className="agent-fab" onClick={()=>navigate("agent")}><Sparkles size={18}/> AI Agent</button>}
    {showUploadConfirm&&<UploadConfirmModal
      files={pendingUploadFiles}
      setFiles={setPendingUploadFiles}
      customer={uploadCustomer}
      setCustomer={setUploadCustomer}
      customers={uploadCustomers}
      onAddFiles={handleUpload}
      onCancel={()=>{setPendingUploadFiles([]);setShowUploadConfirm(false)}}
      onConfirm={confirmUpload}
    />}    {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div></WorkspaceContext.Provider>
}

export default App;
