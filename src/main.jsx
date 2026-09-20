import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText,
  Inbox, Mail, Menu, MoreHorizontal, Package, Plus, Search,
  Settings, ShieldCheck, Sparkles, Users, X, Zap
} from "lucide-react";
import "./styles.css";

const packs = [
  { id:"PK-10482", customer:"Acme Components Ltd", docs:4, status:"Needs review", confidence:91, received:"16 Sep 2026, 15:42", ticket:"TK-88421" },
  { id:"PK-10481", customer:"Northstar Manufacturing", docs:7, status:"Processing", confidence:96, received:"16 Sep 2026, 15:38", ticket:"TK-88420" },
  { id:"PK-10480", customer:"Bancale Trading", docs:3, status:"Validated", confidence:98, received:"16 Sep 2026, 15:31", ticket:"TK-88419" },
  { id:"PK-10479", customer:"Raven Industrial", docs:5, status:"Needs review", confidence:88, received:"16 Sep 2026, 15:12", ticket:"TK-88418" }
];

const customers = [
  {name:"Acme Components Ltd", code:"ACME-001", mailbox:"customs.acme@inbox.example", rules:12, processed:"2,481"},
  {name:"Northstar Manufacturing", code:"NSTM-014", mailbox:"customs.northstar@inbox.example", rules:8, processed:"1,972"},
  {name:"Bancale Trading", code:"BANC-007", mailbox:"customs.bancale@inbox.example", rules:15, processed:"3,108"},
  {name:"Raven Industrial", code:"RAVN-021", mailbox:"customs.raven@inbox.example", rules:6, processed:"1,406"}
];

const DOC_DB_NAME="customs-idp-documents";
const DOC_STORE="files";
function openDocDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DOC_DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DOC_STORE))req.result.createObjectStore(DOC_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveUploadedDocument(id,file){const db=await openDocDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,"readwrite");tx.objectStore(DOC_STORE).put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function getUploadedDocument(id){const db=await openDocDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,"readonly");const req=tx.objectStore(DOC_STORE).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}

const sampleLines = [
  {line:1,description:"Oak wooden packaging boxes",hs:"4415 10 00",origin:"HU",qty:24,net:"10.080",gross:"11.420",value:"384.00",confidence:97},
  {line:2,description:"Bancale Legno pallets",hs:"4415 20 90",origin:"IT",qty:6,net:"0.000",gross:"3.180",value:"120.00",confidence:93},
  {line:3,description:"Protective timber spacers",hs:"4415 10 90",origin:"HU",qty:18,net:"7.560",gross:"8.410",value:"216.00",confidence:94}
];

const TEST_USERS=[
  {id:"liam",name:"Liam Wingrove",role:"manager",initials:"LW"},
  {id:"muhammad",name:"Muhammad Amer",role:"manager",initials:"MA"},
  {id:"processor1",name:"Data Processor 1",role:"user",initials:"P1"},
  {id:"processor2",name:"Data Processor 2",role:"user",initials:"P2"}
];

function TestUserLogin({onSelect}){
  return <div className="test-login">
    <div className="test-login-card">
      <div className="test-login-brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div>
      <div className="test-login-copy"><div className="eyebrow">Test environment</div><h1>Select user</h1><p>No email or password is required. Choose the test user you want to work as.</p></div>
      <div className="test-user-list">
        {TEST_USERS.map(user=><button className="test-user-button" key={user.id} onClick={()=>onSelect(user)}>
          <span className="test-user-avatar">{user.initials}</span>
          <span><b>{user.name}</b><small>{user.role==="manager"?"Manager":"Data Processor"}</small></span>
          <ArrowRight size={16}/>
        </button>)}
      </div>
    </div>
  </div>;
}

function App(){
  const [currentUser,setCurrentUser]=useState(()=>{
    try{
      const saved=localStorage.getItem("customs-idp-user");
      return TEST_USERS.find(u=>u.id===saved)||null;
    }catch{return null;}
  });
  const [page,setPage]=useState("inbox");
  const [selectedPack,setSelectedPack]=useState(packs[0]);
  const [agentOpen,setAgentOpen]=useState(true);
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const currentUserRole=currentUser?.role||"";
  const currentUserName=currentUser?.name||"";
  const currentUserInitials=currentUser?.initials||"";
  const canViewManager=currentUserRole==="manager" || currentUserRole==="admin";
  const [query,setQuery]=useState("");
  const [toast,setToast]=useState("");
  const [livePacks,setLivePacks]=useState(()=>{
    try { const saved=localStorage.getItem("customs-idp-packs"); return saved ? JSON.parse(saved) : packs; }
    catch { return packs; }
  });
  const [dataSource,setDataSource]=useState("local");
  useEffect(()=>{
    let active=true;
    (async()=>{
      try {
        const response=await fetch("/api/packs");
        if(!response.ok) throw new Error("Database unavailable");
        const data=await response.json();
        if(active && Array.isArray(data.packs)){
  if(data.packs.length){
    // Keep browser-stored document metadata when older database rows pre-date
    // persistent uploadedFiles support, and prefer database metadata once present.
    const localPackMap=new Map((livePacks||[]).map(pack=>[pack.id,pack]));
    let nextPacks=data.packs.map(pack=>{
      const local=localPackMap.get(pack.id);
      return pack.uploadedFiles?.length ? pack : (local?.uploadedFiles?.length ? {...pack,uploadedFiles:local.uploadedFiles} : pack);
    });
    try{
      const resetKey="customs-idp-inbox-reset-v2";
      if(!localStorage.getItem(resetKey)){
        nextPacks=nextPacks.map(pack=>({
          ...pack,
          status:pack.status==="Validated"||pack.status==="Posted to LCA"?"Needs review":pack.status,
          processingCompletedAt:undefined,
          validationStatus:undefined,
          validationChecks:undefined,
          postedToLCAAt:undefined
        }));
        await Promise.all(nextPacks.map(pack=>fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pack)})));
        localStorage.setItem(resetKey,"1");
      }
    }catch{}
    setLivePacks(nextPacks);
    // Backfill document metadata to Supabase for packs restored from local browser storage.
    const restoredWithDocuments=nextPacks.filter(pack=>{
      const local=localPackMap.get(pack.id);
      return !data.packs.find(dbPack=>dbPack.id===pack.id)?.uploadedFiles?.length && local?.uploadedFiles?.length;
    });
    if(restoredWithDocuments.length){
      await Promise.all(restoredWithDocuments.map(pack=>fetch("/api/packs",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(pack)
      })));
    }
  } else if(livePacks.length){
    await Promise.all(livePacks.map(pack=>fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pack)})));
  }
  setDataSource("database");
}
      } catch { /* keep local prototype data until database credentials are configured */ }
    })();
    return()=>{active=false;};
  },[]);
  useEffect(()=>{ try { localStorage.setItem("customs-idp-packs",JSON.stringify(livePacks)); } catch {} },[livePacks]);
  const persistPack=async(pack)=>{
    try{
      const response=await fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pack)});
      if(!response.ok) throw new Error("Database save failed");
      setDataSource("database");
      return true;
    }catch{return false;}
  };
  const uploadRef=useRef(null);
  const reprocessPack=async(pack)=>{
    if(!pack)return;
    const files=pack.uploadedFiles||[];
    if(!files.length){
      notify("No uploaded documents are available to reprocess");
      return;
    }
    const processing={...pack,status:"Processing",processingError:undefined,validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined,processingStartedAt:new Date().toISOString()};
    setSelectedPack(processing);
    setLivePacks(prev=>prev.map(p=>p.id===processing.id?processing:p));
    persistPack(processing);
    notify("Re-processing documents — AI extraction started");
    try{
      let source=null;
      if(files[0].storagePath){
        const storageResponse=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"signed-url",path:files[0].storagePath})});
        const storageData=await storageResponse.json();
        if(!storageResponse.ok) throw new Error(storageData.error||"Stored document could not be opened");
        const fileResponse=await fetch(storageData.signedUrl);
        if(!fileResponse.ok) throw new Error("Stored document could not be downloaded");
        source=await fileResponse.blob();
      }else{
        source=await getUploadedDocument(files[0].id);
      }
      if(!source)throw new Error("The uploaded document is no longer available");
      const buffer=await source.arrayBuffer();
      const bytes=new Uint8Array(buffer);
      let binary="";
      const chunk=0x8000;
      for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
      const dataUrl=`data:${source.type||"application/octet-stream"};base64,${btoa(binary)}`;
      const response=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileData:dataUrl,filename:files[0].name,mimeType:source.type})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Re-processing failed");
      const processed={...processing,status:"Needs review",confidence:Math.round((result.extraction.confidence||0)*100),extractedData:result.extraction};
      setSelectedPack(processed);
      setLivePacks(prev=>prev.map(p=>p.id===processed.id?processed:p));
      persistPack(processed);
      notify("Re-processing complete — review the new extraction");
    }catch(error){
      const failed={...processing,status:"Needs review",processingError:error.message};
      setSelectedPack(failed);
      setLivePacks(prev=>prev.map(p=>p.id===failed.id?failed:p));
      persistPack(failed);
      notify("Re-processing failed — check the pack for details");
    }
  };

  const handleUpload=async(files)=>{
    const selected=Array.from(files||[]);
    if(!selected.length) return;
    const file=selected[0];
    const highest=livePacks.reduce((max,p)=>Math.max(max,Number(String(p.id||"").replace("PK-",""))||0),10482);
    const id=`PK-${highest+1}`;
    const processingStartedAt=new Date().toISOString();
    let uploadedFiles;
    try{
      uploadedFiles=await Promise.all(selected.map(async(f,index)=>{
        const localId=`${id}-${index}`;
        await saveUploadedDocument(localId,f);
        const storageResponse=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"upload-url",packId:id,filename:f.name,contentType:f.type})});
        const storageData=await storageResponse.json();
        if(!storageResponse.ok) throw new Error(storageData.error||"Could not create storage upload URL");
        const uploadResponse=await fetch(storageData.signedUrl,{method:"PUT",headers:{"Content-Type":f.type||"application/octet-stream"},body:f});
        if(!uploadResponse.ok) throw new Error(`Could not upload ${f.name} to document storage`);
        return {id:localId,name:f.name,size:f.size,type:f.type,storagePath:storageData.path};
      }));
    }catch(error){
      notify(`Document storage upload failed: ${error.message}`);
      return;
    }
    const newPack={id,customer:"Unassigned customer",docs:selected.length,status:"Processing",confidence:0,received:processingStartedAt,processingStartedAt,ticket:`UPLOAD-${Date.now().toString().slice(-5)}`,assignedTo:"Unassigned",uploadedFiles};
    setLivePacks(prev=>[newPack,...prev]);
    persistPack(newPack);
    setSelectedPack(newPack);
    navigate("review");
    notify("Document uploaded — AI extraction started");
    try {
      const buffer=await file.arrayBuffer();
      const bytes=new Uint8Array(buffer);
      let binary="";
      const chunk=0x8000;
      for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
      const base64=btoa(binary);
      const dataUrl=`data:${file.type || "application/octet-stream"};base64,${base64}`;
      const response=await fetch("/api/extract",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({fileData:dataUrl,filename:file.name,mimeType:file.type})
      });
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || "Extraction failed");
      const processed={...newPack,status:"Needs review",confidence:Math.round((result.extraction.confidence||0)*100),extractedData:result.extraction};
      setSelectedPack(processed);
      setLivePacks(prev=>prev.map(p=>p.id===id?processed:p));
      persistPack(processed);
      notify("AI extraction complete — review the extracted data");
    } catch(error) {
      const failed={...newPack,status:"Needs review",processingError:error.message};
      setSelectedPack(failed);
      setLivePacks(prev=>prev.map(p=>p.id===id?failed:p));
      persistPack(failed);
      notify("Extraction failed — check the pack for details");
    }
  };

  const filteredPacks=useMemo(()=>livePacks.filter(p=>
    [p.id,p.customer,p.status,p.ticket].join(" ").toLowerCase().includes(query.toLowerCase())
  ),[livePacks,query]);

  const navigate=(p)=>{setPage(p);setMobileMenuOpen(false);};
  const notify=(msg)=>{setToast(msg);setTimeout(()=>setToast(""),2500)};
  const assignPack=(packId,assignedTo)=>{const updated={...livePacks.find(p=>p.id===packId),assignedTo};setLivePacks(prev=>prev.map(p=>p.id===packId?updated:p));if(selectedPack?.id===packId)setSelectedPack(prev=>({...prev,assignedTo}));persistPack(updated);notify(`Pack ${packId} assigned to ${assignedTo}`)};
  const validatePack=()=>{
  if(!selectedPack)return;
  const lines=selectedPack.extractedData?.lines||[];
  const checks=lines.map((line,index)=>({
    lineNo:line.lineNo||index+1,
    status:"Pending",
    message:"Customer strategy validation will run here."
  }));
  const validated={...selectedPack,status:"Ready",validationStatus:"Validated",validationChecks:checks};
  setSelectedPack(validated);
  setLivePacks(prev=>prev.map(p=>p.id===validated.id?validated:p));
  persistPack(validated);
  notify("Data validation complete — customer strategy checks passed in test mode");
};
const postToLCA=()=>{
  if(!selectedPack)return;
  if(selectedPack.validationStatus!=="Validated" || selectedPack.status!=="Ready"){
    notify("Validate the extracted data before posting to LCA");
    return;
  }
  const now=new Date().toISOString();
  const assignedTo=selectedPack.assignedTo&&selectedPack.assignedTo!=="Unassigned"?selectedPack.assignedTo:currentUserName;
  const posted={...selectedPack,status:"Posted to LCA",assignedTo,processingCompletedAt:selectedPack.processingCompletedAt||now,postedToLCAAt:now};
  setSelectedPack(posted);
  setLivePacks(prev=>prev.map(p=>p.id===posted.id?posted:p));
  persistPack(posted);
  notify("Pack posted to LCA");
  navigate("inbox");
};

  if(!currentUser)return <TestUserLogin onSelect={user=>{
    setCurrentUser(user);
    try{localStorage.setItem("customs-idp-user",user.id);}catch{}
    setPage("inbox");
  }}/>;

  return <div className={"app-shell "+(sidebarCollapsed?"sidebar-collapsed":"")}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div>
      <div className="workspace"><div className="avatar">{currentUserInitials}</div><div><b>{currentUserName}</b><span>{currentUserRole==="manager"?"Manager":"Data Processor"} · {dataSource==="database"?"Database connected":"Prototype storage"}</span></div></div>
      <nav>
        <NavItem icon={Inbox} label="Inbox" badge={livePacks.length} active={page==="inbox"} onClick={()=>navigate("inbox")}/>
        {canViewManager && <NavItem icon={Activity} label="Manager" active={page==="manager"} onClick={()=>navigate("manager")}/>}
        <NavItem icon={Users} label="Customers" active={page==="customers"} onClick={()=>navigate("customers")}/>
        <NavItem icon={Bot} label="AI Agent" active={page==="agent"} onClick={()=>navigate("agent")}/>
      </nav>
      <div className="side-bottom">
        <NavItem icon={Settings} label="Settings" active={page==="settings"} onClick={()=>navigate("settings")}/>
        <button className="switch-user-btn" onClick={()=>{setCurrentUser(null);try{localStorage.removeItem("customs-idp-user");}catch{};setPage("inbox")}}><Users size={16}/><span>Switch user</span></button>
        <div className="system-status"><span className="dot"></span><div><b>All systems operational</b><span>Last sync 16:02</span></div></div>
      </div>
    </aside>
    <button className="sidebar-collapse-btn" aria-label={sidebarCollapsed?"Expand sidebar":"Collapse sidebar"} onClick={()=>setSidebarCollapsed(v=>!v)}>{sidebarCollapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>

    {mobileMenuOpen && <div className="mobile-menu-overlay" onClick={()=>setMobileMenuOpen(false)}><aside className="mobile-menu" onClick={e=>e.stopPropagation()}><div className="mobile-menu-head"><div className="brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div><button className="icon-btn" aria-label="Close navigation" onClick={()=>setMobileMenuOpen(false)}><X size={20}/></button></div><div className="mobile-workspace"><div className="avatar">{currentUserInitials}</div><div><b>{currentUserName}</b><span>{currentUserRole==="manager"?"Manager":"Data Processor"} · {dataSource==="database"?"Database connected":"Prototype storage"}</span></div></div><nav><NavItem icon={Inbox} label="Inbox" badge={livePacks.length} active={page==="inbox"} onClick={()=>navigate("inbox")}/>{canViewManager && <NavItem icon={Activity} label="Manager" active={page==="manager"} onClick={()=>navigate("manager")}/>}<NavItem icon={Users} label="Customers" active={page==="customers"} onClick={()=>navigate("customers")}/><NavItem icon={Bot} label="AI Agent" active={page==="agent"} onClick={()=>navigate("agent")}/><NavItem icon={Settings} label="Settings" active={page==="settings"} onClick={()=>navigate("settings")}/></nav><button className="switch-user-btn mobile-switch-user" onClick={()=>{setCurrentUser(null);try{localStorage.removeItem("customs-idp-user");}catch{};setPage("inbox")}}><Users size={16}/><span>Switch user</span></button><div className="mobile-system-status"><span className="dot"></span><div><b>All systems operational</b><span>Last sync 16:02</span></div></div></aside></div>}

    <main className="main">
      <header className="topbar">
        <button className="mobile-menu-btn" aria-label="Open navigation" onClick={()=>setMobileMenuOpen(true)}><Menu size={20}/></button><div className="mobile-brand"><strong>Customs IDP</strong></div>
        <div className="crumb">Operations <span>/</span> {page[0].toUpperCase()+page.slice(1)}</div>
        <div className="top-actions"><button className="icon-btn" aria-label="Open inbox" onClick={()=>navigate("inbox")}><Mail size={18}/></button><div className="top-avatar" title={currentUserName}>{currentUserInitials}</div></div>
      </header>

      <input ref={uploadRef} className="hidden-upload" type="file" multiple accept=".pdf,.xlsx,.xls,.doc,.docx,.csv,.png,.jpg,.jpeg,.eml,.msg" onChange={e=>handleUpload(e.target.files)}/>
      <div className="content">
        {page==="manager" && canViewManager && <ManagerPage livePacks={livePacks} dataSource={dataSource}/>} 
        {page==="dashboard" && <Dashboard navigate={navigate} notify={notify} livePacks={livePacks}/>}
        {page==="inbox" && <InboxPage packs={filteredPacks} query={query} setQuery={setQuery} openPack={(p)=>{setSelectedPack(p);navigate("review")}} onUpload={handleUpload} onAssign={assignPack}/>}
        
        {page==="review" && <Review pack={selectedPack} back={()=>navigate("inbox")} notify={notify} onAssign={assignPack} validatePack={validatePack} postToLCA={postToLCA} reprocessPack={reprocessPack}/>}
        {page==="customers" && <Customers notify={notify}/>}
        {page==="agent" && <AgentPage/>}
        {page==="settings" && <SettingsPage/>}
      </div>
    </main>

    {agentOpen && page!=="agent" && <button className="agent-fab" onClick={()=>navigate("agent")}><Sparkles size={18}/> AI Agent</button>}
    {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>
}

function NavItem({icon:Icon,label,badge,active,onClick}){return <button className={"nav-item "+(active?"active":"")} onClick={onClick}><Icon size={18}/><span>{label}</span>{badge&&<em>{badge}</em>}</button>}

function Dashboard({navigate,notify,livePacks}){
 const totalPacks=livePacks.length;
 const totalDocuments=livePacks.reduce((n,p)=>n+(Number(p.docs)||0),0);
 const validated=livePacks.filter(p=>p.status==="Validated").length;
 const processing=livePacks.filter(p=>p.status==="Processing").length;
 const review=livePacks.filter(p=>p.status==="Needs review").length;
 const avgConfidence=totalPacks?Math.round(livePacks.reduce((n,p)=>n+(Number(p.confidence)||0),0)/totalPacks):0;
 const validationRate=totalPacks?((validated/totalPacks)*100).toFixed(1):"0.0";
 const recent=livePacks.slice(0,6);
 return <section>
  <div className="page-head"><div><div className="eyebrow">Live operation · {new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}</div><h1>{new Date().getHours()<12?"Good morning":new Date().getHours()<18?"Good afternoon":"Good evening"}, Liam</h1><p>Live metrics from the packs currently loaded into Customs IDP.</p></div><button className="primary" onClick={()=>navigate("inbox")}><Inbox size={17}/> Open inbox</button></div>
  <div className="metric-grid">
    <Metric label="Live packs" value={totalPacks.toLocaleString()} delta="Current inbox" icon={Package}/>
    <Metric label="Documents in packs" value={totalDocuments.toLocaleString()} delta="Current inbox" icon={FileText}/>
    <Metric label="Auto-validated" value={validationRate+"%"} delta={validated+" validated"} icon={ShieldCheck}/>
    <Metric label="Needs review" value={review.toLocaleString()} delta={processing+" processing"} icon={AlertCircle} warning={review>0}/>
  </div>
  <div className="dashboard-grid">
    <div className="panel"><div className="panel-head"><div><h2>Live processing queue</h2><p>Current status of every pack in the inbox</p></div><button className="text-btn" onClick={()=>navigate("inbox")}>Open inbox <ArrowRight size={15}/></button></div><div className="queue-list"><Queue label="Validated" value={validated} pct={validationRate} cls="good"/><Queue label="Processing" value={processing} pct={totalPacks?((processing/totalPacks)*100).toFixed(1):"0.0"} cls="blue"/><Queue label="Needs review" value={review} pct={totalPacks?((review/totalPacks)*100).toFixed(1):"0.0"} cls="warn"/></div></div>
    <div className="panel"><div className="panel-head"><div><h2>Extraction health</h2><p>Based on live packs currently loaded</p></div></div><div className="queue-list"><Queue label="Average confidence" value={avgConfidence+"%"} pct={avgConfidence} cls="good"/><Queue label="Documents" value={totalDocuments} pct={100} cls="blue"/><Queue label="Packs requiring attention" value={review} pct={totalPacks?((review/totalPacks)*100).toFixed(1):"0.0"} cls="warn"/></div><button className="text-btn" onClick={()=>navigate("agent")}>Open AI Agent <ArrowRight size={15}/></button></div>
  </div>
  <div className="panel recent"><div className="panel-head"><div><h2>Recent live packs</h2><p>Latest packs currently in the operation</p></div><button className="text-btn" onClick={()=>navigate("inbox")}>View inbox <ArrowRight size={15}/></button></div><PackTable packs={recent} onOpen={(p)=>{navigate("inbox")}}/></div>
 </section>
}

function ManagerPage({livePacks,dataSource}){
 const [period,setPeriod]=useState("7d");
 const [customFrom,setCustomFrom]=useState("");
 const [customTo,setCustomTo]=useState("");
 const [appliedFrom,setAppliedFrom]=useState("");
 const [appliedTo,setAppliedTo]=useState("");
 const now=new Date();
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 let rangeStart=null,rangeEnd=null;
 if(period==="today"){rangeStart=today;rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="yesterday"){rangeStart=new Date(today.getTime()-86400000);rangeEnd=new Date(today.getTime()-1);}
 if(period==="7d"){rangeStart=new Date(today.getTime()-6*86400000);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="30d"){rangeStart=new Date(today.getTime()-29*86400000);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="thisMonth"){rangeStart=new Date(today.getFullYear(),today.getMonth(),1);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="lastMonth"){rangeStart=new Date(today.getFullYear(),today.getMonth()-1,1);rangeEnd=new Date(today.getFullYear(),today.getMonth(),1)-1;rangeEnd=new Date(rangeEnd);}
 if(period==="thisWeek"){const day=today.getDay()||7;rangeStart=new Date(today.getTime()-(day-1)*86400000);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="lastWeek"){const day=today.getDay()||7;rangeStart=new Date(today.getTime()-(day+6)*86400000);rangeEnd=new Date(today.getTime()-(day-1)*86400000-1);}
 if(period==="custom" && appliedFrom){rangeStart=new Date(appliedFrom+"T00:00:00");rangeEnd=appliedTo?new Date(appliedTo+"T23:59:59.999"):new Date(appliedFrom+"T23:59:59.999");}
 const filtered=livePacks.filter(p=>{
   if(!rangeStart)return true;
   const received=new Date(p.received);
   return !Number.isNaN(received.getTime()) && received>=rangeStart && received<=rangeEnd;
 });
 const totalPacks=filtered.length;
 const totalDocuments=filtered.reduce((n,p)=>n+(Number(p.docs)||0),0);
 const validated=filtered.filter(p=>p.status==="Ready"||p.status==="Validated"||p.status==="Posted to LCA").length;
 const review=filtered.filter(p=>p.status==="Needs review").length;
 const processing=filtered.filter(p=>p.status==="Processing").length;
 const failed=filtered.filter(p=>p.status==="Failed"||p.status==="failed").length;
 const avgConfidence=totalPacks?Math.round(filtered.reduce((n,p)=>n+(Number(p.confidence)||0),0)/totalPacks):0;
 const validationRate=totalPacks?((validated/totalPacks)*100).toFixed(1):"0.0";
 const reviewRate=totalPacks?((review/totalPacks)*100).toFixed(1):"0.0";
 const failureRate=totalPacks?((failed/totalPacks)*100).toFixed(1):"0.0";
 const periodLabel={today:"Today",yesterday:"Yesterday","7d":"Last 7 days","30d":"Last 30 days",thisWeek:"This week",lastWeek:"Last week",thisMonth:"This month",lastMonth:"Last month",all:"All time",custom:"Custom range"}[period];
 const formatDuration=(ms)=>{if(!Number.isFinite(ms)||ms<0)return "—";const mins=Math.round(ms/60000);if(mins<60)return mins+" min";const h=Math.floor(mins/60);const m=mins%60;return h+"h "+String(m).padStart(2,"0")+"m"};
 const team=["Liam Wingrove","Data Processor 1","Data Processor 2","Muhammad Amer"].map(name=>{
   const rows=filtered.filter(p=>p.assignedTo===name);
   const docs=rows.reduce((n,p)=>n+(Number(p.docs)||0),0);
   const reviews=rows.filter(p=>p.status==="Needs review").length;
   const validatedBy=rows.filter(p=>p.status==="Ready"||p.status==="Validated"||p.status==="Posted to LCA").length;
   const timed=rows.filter(p=>p.processingStartedAt&&p.processingCompletedAt).map(p=>new Date(p.processingCompletedAt).getTime()-new Date(p.processingStartedAt).getTime()).filter(ms=>Number.isFinite(ms)&&ms>=0);
   const avgProcessingTime=timed.length?formatDuration(timed.reduce((a,b)=>a+b,0)/timed.length):"—";
   const confidence=rows.length?Math.round(rows.reduce((n,p)=>n+(Number(p.confidence)||0),0)/rows.length)+"%":"—";
   return {name,role:name==="Liam Wingrove"||name==="Muhammad Amer"?"Manager":"Data Processor",packs:rows.length,docs,reviews,validated:validatedBy,confidence,avgProcessingTime};
  });
 const unassigned=filtered.filter(p=>!p.assignedTo||p.assignedTo==="Unassigned").length;
 const customersLive=[...new Set(filtered.map(p=>p.customer).filter(Boolean))];
 return <section>
  <div className="page-head">
   <div><div className="eyebrow">Management · operational intelligence</div><h1>Manager</h1><p>Live operational metrics from the central pack database.</p></div>
   <div className="manager-head-actions">
    <span className="online-pill"><span></span>{dataSource==="database"?"Database connected":"Prototype storage"}</span>
    <select className="manager-period-select" value={period} onChange={e=>setPeriod(e.target.value)}>
     <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="thisWeek">This week</option><option value="lastWeek">Last week</option><option value="thisMonth">This month</option><option value="lastMonth">Last month</option><option value="all">All time</option><option value="custom">Custom range</option>
    </select>
    {period==="custom" && <div className="manager-custom-range"><label>From<input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label><label>To<input type="date" value={customTo} min={customFrom||undefined} onChange={e=>setCustomTo(e.target.value)}/></label><button type="button" className="manager-apply-range" disabled={!customFrom} onClick={()=>{setAppliedFrom(customFrom);setAppliedTo(customTo||customFrom);}}>Apply</button></div>}
   </div>
  </div>
  <div className="metric-grid">
   <Metric label="Packs processed" value={totalPacks.toLocaleString()} delta={validated+" validated"} icon={Package}/>
   <Metric label="Documents processed" value={totalDocuments.toLocaleString()} delta={periodLabel} icon={FileText}/>
   <Metric label="Average AI confidence" value={avgConfidence+"%"} delta={totalPacks?periodLabel:"No packs in period"} icon={Sparkles}/>
   <Metric label="Human review queue" value={review.toLocaleString()} delta={processing+" still processing"} icon={AlertCircle} warning={review>0}/>
  </div>
  <div className="manager-kpi-grid">
   <div className="panel mini-kpi"><span>Auto-validation rate</span><strong>{validationRate}%</strong><small>{validated} of {totalPacks} packs validated</small></div>
   <div className="panel mini-kpi"><span>Human review rate</span><strong>{reviewRate}%</strong><small>{review} packs require review</small></div>
   <div className="panel mini-kpi"><span>Failure rate</span><strong>{failureRate}%</strong><small>{failed} failed packs</small></div>
   <div className="panel mini-kpi"><span>Documents / pack</span><strong>{totalPacks?(totalDocuments/totalPacks).toFixed(1):"0.0"}</strong><small>Average in selected period</small></div>
  </div>
  <div className="manager-grid">
   <div className="panel">
    <div className="panel-head"><div><h2>Team performance</h2><p>{periodLabel} · based on pack ownership</p></div></div>
    <div className="manager-table-wrap"><table><thead><tr><th>TEAM MEMBER</th><th>ROLE</th><th>PACKS</th><th>DOCUMENTS</th><th>VALIDATED</th><th>REVIEWS</th><th>AVG CONF.</th><th>AVG PROCESSING</th></tr></thead><tbody>{team.map(m=><tr key={m.name}><td><b>{m.name}</b></td><td>{m.role}</td><td>{m.packs}</td><td>{m.docs}</td><td>{m.validated}</td><td>{m.reviews}</td><td>{m.confidence}</td><td>{m.avgProcessingTime}</td></tr>)}</tbody></table></div>
    <div className="manager-note"><ShieldCheck size={15}/><span>{unassigned?unassigned+" pack"+(unassigned===1?" is":"s are")+" currently unassigned in this period.":"All packs in this period have an owner."} Assign ownership from Inbox to populate team performance.</span></div>
   </div>
   <div className="panel"><div className="panel-head"><div><h2>Platform health</h2><p>{periodLabel} workload across the operation</p></div></div><div className="queue-list"><Queue label="Validated" value={validated} pct={totalPacks?((validated/totalPacks)*100).toFixed(1):"0.0"} cls="good"/><Queue label="Processing" value={processing} pct={totalPacks?((processing/totalPacks)*100).toFixed(1):"0.0"} cls="blue"/><Queue label="Needs review" value={review} pct={totalPacks?((review/totalPacks)*100).toFixed(1):"0.0"} cls="warn"/></div></div>
  </div>
  <div className="panel manager-section">
   <div className="panel-head"><div><h2>Customer workload</h2><p>{periodLabel} customer activity</p></div></div>
   <div className="manager-customer-grid">
    {customersLive.length?customersLive.map(name=>{
      const rows=filtered.filter(p=>p.customer===name);
      const docs=rows.reduce((n,p)=>n+(Number(p.docs)||0),0);
      const needs=rows.filter(p=>p.status==="Needs review").length;
      const avg=rows.length?Math.round(rows.reduce((n,p)=>n+(Number(p.confidence)||0),0)/rows.length):0;
      return <div className="manager-customer" key={name}><b>{name}</b><span>{rows.length} packs · {docs} documents</span><small>{needs} requiring review · {avg}% avg confidence</small></div>;
    }):<div className="manager-empty">No customer activity is recorded for {periodLabel.toLowerCase()}.</div>}
   </div>
  </div>
  <div className="manager-section-head"><div><h2>Management controls</h2><p>Operational controls connected to the central database.</p></div></div>
  <div className="manager-control-grid">
   <div className="panel manager-control"><Activity size={18}/><div><b>Processing analytics</b><span>{totalPacks} packs and {totalDocuments} documents in {periodLabel.toLowerCase()}.</span></div></div>
   <div className="panel manager-control"><Users size={18}/><div><b>Team allocation</b><span>Assign pack ownership from the Inbox owner column.</span></div></div>
   <div className="panel manager-control"><ShieldCheck size={18}/><div><b>Quality & intervention</b><span>{review} packs currently require human review.</span></div></div>
   <div className="panel manager-control"><FileText size={18}/><div><b>Processing time</b><span>Timing fields will populate once start/completion timestamps are recorded.</span></div></div>
  </div>
 </section>;
}
function Metric({label,value,delta,icon:Icon,warning}){return <div className="metric"><div className={"metric-icon "+(warning?"warning":"")}><Icon size={19}/></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small className={delta.startsWith("-")?"positive":""}>{delta}</small></div></div>}
function Queue({label,value,pct,cls}){return <div className="queue"><div><span className={"queue-dot "+cls}></span><b>{label}</b><strong>{value}</strong></div><div className="progress"><i className={cls} style={{width:pct+"%"}}></i></div><small>{pct}%</small></div>}

function InboxPage({packs,query,setQuery,openPack,title="Inbox",onUpload,onAssign}){
 return <section><div className="page-head"><div><div className="eyebrow">Document processing</div><h1>{title}</h1><p>Review incoming document packs, extraction confidence and validation status.</p></div><button className="primary" onClick={()=>document.querySelector(".hidden-upload")?.click()}><Plus size={17}/> Upload documents</button></div>
 <div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search packs, customers or tickets..."/></div><button className="filter">Status <ChevronDown size={15}/></button><button className="filter">Customer <ChevronDown size={15}/></button></div>
 <div className="panel"><PackTable packs={packs} onOpen={openPack} onAssign={onAssign}/></div></section>
}

function PackTable({packs,onOpen,onAssign}){return <div className="table-wrap"><table><thead><tr><th>PACK</th><th>CUSTOMER</th><th>OWNER</th><th>DOCUMENTS</th><th>STATUS</th><th>CONFIDENCE</th><th>RECEIVED</th><th></th></tr></thead><tbody>{packs.map(p=><tr key={p.id} onClick={()=>onOpen(p)}><td><b>{p.id}</b><small>{p.ticket}</small></td><td>{p.customer}</td><td><select className="owner-select" value={p.assignedTo||"Unassigned"} onClick={e=>e.stopPropagation()} onChange={e=>onAssign?.(p.id,e.target.value)}><option>Unassigned</option><option>Liam Wingrove</option><option>Data Processor 1</option><option>Data Processor 2</option><option>Muhammad Amer</option></select></td><td>{p.docs} documents</td><td><Status status={p.status}/></td><td><div className="confidence"><span>{p.confidence}%</span><div><i style={{width:p.confidence+"%"}}></i></div></div></td><td>{p.received}</td><td><button className="row-btn"><MoreHorizontal size={17}/></button></td></tr>)}</tbody></table></div>}
function Status({status}){let c=status==="Validated"?"good":status==="Processing"?"processing":"review";return <span className={"status "+c}><span></span>{status}</span>}

function Review({pack,back,notify,onAssign,validatePack,postToLCA,reprocessPack}){
 const [docUrls,setDocUrls]=useState({});
 const [tab,setTab]=useState("extraction");
 const [chat,setChat]=useState("");
 const [selectedDocumentId,setSelectedDocumentId]=useState(null);
 const [showPreview,setShowPreview]=useState(()=>{
   try{return localStorage.getItem("customs-idp-review-preview")!=="off";}catch{return true;}
 });
 const [reviewSplit,setReviewSplit]=useState(()=>{
   try{
     const saved=Number(localStorage.getItem("customs-idp-review-split"));
     return Number.isFinite(saved)&&saved>=32&&saved<=68?saved:50;
   }catch{return 50;}
 });
 const [resizing,setResizing]=useState(false);

 useEffect(()=>{let active=true;(async()=>{
   const entries=await Promise.all((pack.uploadedFiles||[]).map(async f=>{
     try{
       if(f.storagePath){
         const response=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"signed-url",path:f.storagePath})});
         const data=await response.json();
         if(response.ok&&data.signedUrl)return [f.id,data.signedUrl];
       }
       const file=await getUploadedDocument(f.id);
       return file?[f.id,URL.createObjectURL(file)]:null;
     }catch{return null;}
   }));
   if(active)setDocUrls(Object.fromEntries(entries.filter(Boolean)));
 })();return()=>{active=false;};},[pack.id,pack.uploadedFiles]);

 const documentRows=pack.uploadedFiles?.length
   ? pack.uploadedFiles
   : [
       {id:"sample-1",name:"Commercial Invoice 88421.pdf"},
       {id:"sample-2",name:"Packing List 88421.pdf"},
       {id:"sample-3",name:"Certificate of Origin.pdf"},
       {id:"sample-4",name:"Transport Document.pdf"}
     ];

 useEffect(()=>{
   if(!documentRows.length){setSelectedDocumentId(null);return;}
   setSelectedDocumentId(current=>documentRows.some(d=>(d.id||d.name)===current)?current:(documentRows[0].id||documentRows[0].name));
 },[pack.id,pack.uploadedFiles?.length]);

 const selectedDocument=documentRows.find(d=>(d.id||d.name)===selectedDocumentId)||documentRows[0];
 const selectedDocumentUrl=selectedDocument ? docUrls[selectedDocument.id] : null;
 const selectedDocumentIsPdf=/\.pdf$/i.test(selectedDocument?.name||"");
 const selectedDocumentIsImage=/^image\//i.test(selectedDocument?.type||"") || /\.(png|jpe?g|webp|gif)$/i.test(selectedDocument?.name||"");
 const selectedDocumentFrameUrl=selectedDocumentUrl&&selectedDocumentIsPdf?`${selectedDocumentUrl}#page=1&view=FitH&zoom=page-width`:selectedDocumentUrl;

 useEffect(()=>{try{localStorage.setItem("customs-idp-review-preview",showPreview?"on":"off");}catch{}},[showPreview]);
 useEffect(()=>{try{localStorage.setItem("customs-idp-review-split",String(reviewSplit));}catch{}},[reviewSplit]);

 useEffect(()=>{
   if(!resizing)return;
   const onMove=e=>{
     const workspace=document.querySelector(".review-workspace-split");
     if(!workspace)return;
     const rect=workspace.getBoundingClientRect();
     const ratio=((e.clientX-rect.left)/rect.width)*100;
     setReviewSplit(Math.max(32,Math.min(68,ratio)));
   };
   const onUp=()=>setResizing(false);
   window.addEventListener("pointermove",onMove);
   window.addEventListener("pointerup",onUp);
   document.body.classList.add("review-resizing");
   return()=>{window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);document.body.classList.remove("review-resizing");};
 },[resizing]);

 const extractedPanel=<div className="review-left-column">
   <div className="panel extraction-panel review-data-panel">
     <div className="tabs">
       <button className={tab==="extraction"?"selected":""} onClick={()=>setTab("extraction")}>Extracted data</button>
       <button className={tab==="json"?"selected":""} onClick={()=>setTab("json")}>Middleware JSON</button>
     </div>
     {tab==="extraction"&&<>
       <div className="data-summary">
         {pack.processingError&&<div className="extraction-error"><b>Extraction failed:</b> {pack.processingError}</div>}
         <div><span>Invoice total</span><b>{pack.extractedData?.currency?`${pack.extractedData.currency} ${Number(pack.extractedData.totalInvoiceValue||0).toLocaleString(undefined,{minimumFractionDigits:2})}`:"Awaiting extraction"}</b></div>
         <div><span>Gross mass</span><b>{pack.extractedData?.totalGrossWeight!=null?`${pack.extractedData.totalGrossWeight} kg`:"Awaiting extraction"}</b></div>
         <div><span>Country export</span><b>{pack.extractedData?.countryOfExport||"Awaiting extraction"}</b></div>
         <div><span>Destination</span><b>{pack.extractedData?.sourceCountryOfDestination||"Awaiting extraction"}</b></div>
       </div>
       <div className="section-title">
         <div><h3>Invoice positions</h3><span>{pack.extractedData?.lines?.length||0} lines extracted · AI confidence shown per line</span></div>
         <button className="secondary" onClick={()=>notify("Correction workflow ready — next step is persistent editing")}>Save corrections</button>
       </div>
       <div className="line-table">
         <table>
           <thead><tr><th>#</th><th>DESCRIPTION</th><th>HS CODE</th><th>ORIGIN</th><th>PKGS</th><th>QTY</th><th>WEIGHT KG</th><th>VALUE</th><th></th></tr></thead>
           <tbody>{(pack.extractedData?.lines||[]).map(l=><tr key={l.lineNo}>
             <td>{l.lineNo}</td><td><b>{l.description||"—"}</b><small>{Math.round((l.confidence||0)*100)}% confidence</small></td>
             <td>{l.hsCode||"—"}</td><td><span className="country">{l.sourceCountryCode||"—"}</span></td>
             <td>{l.packages??"—"} {l.packagingType||""}</td><td>{l.quantity??"—"} {l.unitOfMeasure||""}</td><td>{l.weightKg??"—"}</td>
             <td>{pack.extractedData?.currency||""} {l.totalValue??"—"}</td><td><MoreHorizontal size={16}/></td>
           </tr>)}</tbody>
         </table>
       </div>
     </>}
     {tab==="json"&&<pre className="json">{JSON.stringify({
       customerId:"ACME-001",identifier:pack.id,customerReference:"88421",customerCustomerNo:"ACME-UK",
       deliveryTerm_SAD20:"DDP",deliveryTermPlace_SAD20:"Maldon",countryOfExport_SAD15:"HU",
       countryOfDestination_SAD17:"GB",totalAmountInvoiced_SAD22:720,totalAmountInvoicedCurrency_SAD22:"GBP",
       totalGrossMass:23.01,ticketNo:pack.ticket,positions:[]
     },null,2)}</pre>}
   </div>
   <aside className="agent-panel review-agent-panel">
     <div className="agent-title"><div className="agent-orb"><Sparkles size={18}/></div><div><b>Extraction Agent</b><span>Online · customer-aware</span></div></div>
     <div className="agent-insight"><Sparkles size={15}/><div><b>Validation complete</b><p>I found 1 field that may need review: the gross mass was apportioned across the three lines using the configured net-weight ratio.</p></div></div>
     <div className="agent-rule"><span>Applied customer rule</span><b>Gross weight apportionment</b><small>Net-weight ratio · Bancale Legno excluded from net weight</small></div>
     <div className="chat"><div className="message agent">I can correct extracted fields, explain why a value was chosen, or save a correction as a customer rule.</div><div className="chat-input"><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Ask the agent to change something..."/><button onClick={()=>{setChat("");notify("Agent request queued")}}><ArrowRight size={16}/></button></div></div>
   </aside>
 </div>;

 const documentPanel=<div className="review-right-column">
   <div className="panel review-documents-panel">
     <div className="review-documents">
       <div className="review-documents-head">
         <div><h3>Documents</h3><span>{documentRows.length} documents · select a document to preview it</span></div>
       </div>
       <div className="review-document-list">
         {documentRows.map(f=>{
           const id=f.id||f.name, selected=id===selectedDocumentId;
           const isPdf=/\.pdf$/i.test(f.name||"");
           const isImage=/^image\//i.test(f.type||"") || /\.(png|jpe?g|webp|gif)$/i.test(f.name||"");
           const thumbUrl=docUrls[id];
           return <button type="button" className={"review-document-card "+(selected?"selected":"")} key={id} onClick={()=>setSelectedDocumentId(id)}>
             <div className="review-document-icon">{thumbUrl&&isImage?<img src={thumbUrl} alt="" />:thumbUrl&&isPdf?<iframe src={`${thumbUrl}#page=1&view=FitH&zoom=page-width`} title="" tabIndex="-1"/>:<div className="review-document-placeholder"><FileText size={22}/><span>{isPdf?"PDF":"DOC"}</span></div>}</div>
             <div className="review-document-copy"><b>{f.name}</b><span>{isPdf?"PDF":(f.type||"Document").split("/").pop().toUpperCase()} · {f.storagePath?"Stored in Supabase":"Browser fallback"}</span></div>
           </button>;
         })}
       </div>
     </div>
     <div className="review-document-preview">
       <div className="review-document-preview-head">
         <div><span>DOCUMENT PREVIEW</span><b>{selectedDocument?.name||"No document selected"}</b></div>
         <small>{selectedDocumentUrl?"Live source document":"Preview unavailable"}</small>
       </div>
       <div className="review-document-viewer">
         <div className="review-viewer-toolbar">
           <div className="review-viewer-file"><FileText size={14}/><span>{selectedDocument?.name||"No document selected"}</span></div>
           <div className="review-viewer-controls"><span>1 / 1</span><button type="button">−</button><span>100%</span><button type="button">+</button><button type="button">↗</button></div>
         </div>
         <div className={"review-document-preview-body "+(selectedDocumentIsImage?"image-document":"pdf-document")}>
           {selectedDocumentUrl?(selectedDocumentIsImage?<img src={selectedDocumentUrl} alt={selectedDocument?.name||"Document preview"}/>:<iframe src={selectedDocumentFrameUrl} title={selectedDocument?.name||"Document preview"}/>):<div className="review-document-empty"><FileText size={28}/><b>{selectedDocument?.name||"No document available"}</b><span>The document is not available for preview yet. New uploads are stored in the private Supabase document store.</span></div>}
         </div>
       </div>
     </div>
   </div>
 </div>;

 return <section>
   <button className="back" onClick={back}>← Back to inbox</button>
   <div className="review-head">
     <div><div className="eyebrow">{pack.id} · {pack.ticket}</div><h1>{pack.customer}</h1><p>{pack.docs} documents · received {pack.received}</p></div>
     <div className="review-actions">
       <select className="owner-select review-owner" value={pack.assignedTo||"Unassigned"} onChange={e=>onAssign?.(pack.id,e.target.value)}>
         <option>Unassigned</option><option>Liam Wingrove</option><option>Data Processor 1</option><option>Data Processor 2</option><option>Muhammad Amer</option>
       </select>
       <Status status={pack.status}/>
       <button className="secondary" onClick={()=>reprocessPack?.(pack)}>Re-process</button>
       <button className="secondary" onClick={validatePack}>Validate data</button>
       <button className={pack.status==="Ready"?"primary":"secondary"} onClick={postToLCA}>Post to LCA</button>
     </div>
   </div>
   <div className="review-preview-toggle-row">
     <label className="review-preview-toggle"><input type="checkbox" checked={showPreview} onChange={e=>setShowPreview(e.target.checked)}/><span className="review-toggle-track"><i></i></span><span>Show preview</span></label>
     <button className="secondary review-fit-btn" onClick={()=>setReviewSplit(50)}>Reset split</button>
   </div>
   <div className={"review-workspace-split "+(!showPreview?"preview-hidden":"")} style={{"--review-split":showPreview?reviewSplit:100}}>
     {extractedPanel}
     {showPreview&&<>
       <div className={"review-resizer "+(resizing?"active":"")} role="separator" aria-label="Resize extracted data and document preview" onPointerDown={e=>{e.preventDefault();setResizing(true);}} title="Drag to resize"></div>
       {documentPanel}
     </>}
   </div>
 </section>
}
function Customers({notify}){return <section><div className="page-head"><div><div className="eyebrow">Configuration</div><h1>Customers</h1><p>Customer-specific extraction strategies, mailboxes and validation rules.</p></div><button className="primary" onClick={()=>notify("Customer creation flow opened")}><Plus size={17}/> Add customer</button></div><div className="customer-grid">{customers.map(c=><div className="customer-card" key={c.code}><div className="customer-top"><div className="customer-logo">{c.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div><button className="row-btn"><MoreHorizontal size={17}/></button></div><h3>{c.name}</h3><span className="code">{c.code}</span><div className="customer-info"><div><Mail size={15}/><span>{c.mailbox}</span></div><div><Settings size={15}/><span>{c.rules} extraction rules</span></div><div><Activity size={15}/><span>{c.processed} documents processed</span></div></div><button className="full-btn">Open strategy <ArrowRight size={15}/></button></div>)}</div></section>}

function AgentPage(){
 const [messages,setMessages]=useState([{role:"agent",text:"Hi. I can inspect extracted customs data, explain decisions, validate fields, and prepare corrections. Try asking about HU, gross weight, HS codes or customer rules."}]);
 const [input,setInput]=useState("");
 const send=(textValue=input)=>{
   const q=textValue.trim(); if(!q) return;
   setMessages(m=>[...m,{role:"user",text:q}]); setInput("");
   const l=q.toLowerCase(); let reply;
   if(l.includes("gross")||l.includes("weight")) reply="The current pack uses the configured gross-weight apportionment logic: gross weight is distributed across eligible lines using each line's net-weight ratio. Bancale Legno is excluded from the net-weight calculation. In production, I will calculate this from the uploaded documents and show the source values before applying the rule.";
   else if(l.includes("hu")||l.includes("origin")) reply="HU is the ISO country code for Hungary. I would trace the value back to the source document, show the extracted text and confidence, then apply the customer's country-of-origin rule if one exists.";
   else if(l.includes("validate")) reply="I can validate required middleware fields, ISO country codes, procedure-code length and numeric fields. Any failure will be shown with the affected field and source document.";
   else if(l.includes("rule")) reply="I can inspect the customer's active rules and, after you confirm a correction, turn a repeated correction into a customer-specific rule. Rule changes should be recorded in the audit trail.";
   else if(l.includes("change")||l.includes("correct")||l.includes("wrong")) reply="I can make that correction once the pack is loaded. I will show the proposed old value → new value, explain the reason, recalculate dependent fields, and re-run validation before approval.";
   else reply="I understand. In the live version I will use the uploaded pack, extracted fields, source documents and customer strategy as context rather than answering from a generic knowledge base.";
   setTimeout(()=>setMessages(m=>[...m,{role:"agent",text:reply}]),250);
 };
 return <section><div className="page-head"><div><div className="eyebrow">Automation & intelligence</div><h1>AI Agent</h1><p>Explain extraction decisions, validate customs data and maintain customer-specific rules.</p></div><span className="online-pill"><span></span> Online</span></div><div className="agent-page-grid"><div className="panel"><div className="panel-head"><div><h2>Agent capabilities</h2><p>Actions the production agent will perform against a pack</p></div></div>{["Explain why a field was extracted","Correct an extracted value","Create or update a customer rule","Validate middleware fields and ISO codes","Apply weight apportionment rules","Flag low-confidence customs data"].map(x=><div className="capability" key={x}><div className="cap-icon"><Sparkles size={15}/></div><span>{x}</span><CheckCircle2 size={16}/></div>)}</div><div className="panel chat-large"><div className="agent-title"><div className="agent-orb"><Sparkles size={18}/></div><div><b>Customs IDP Agent</b><span>Pack-aware workflow assistant</span></div></div><div className="chat-history">{messages.map((m,i)=><div className={"message "+m.role} key={i}>{m.text}</div>)}<div className="suggestions"><button onClick={()=>send("Why was the gross weight apportioned?")}>Why was the gross weight apportioned?</button><button onClick={()=>send("Show Acme's active rules")}>Show Acme's active rules</button><button onClick={()=>send("Validate this pack for middleware")}>Validate this pack for middleware</button></div></div><div className="chat-input"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask the agent anything about this operation..."/><button onClick={()=>send()}><ArrowRight size={16}/></button></div></div></div></section>}

function SettingsPage(){return <section><div className="page-head"><div><div className="eyebrow">Platform</div><h1>Settings</h1><p>Core processing, middleware and integration configuration.</p></div></div><div className="settings-grid"><div className="panel settings-card"><h2>Middleware</h2><p>Configure the output contract used by the downstream customs system.</p><label>Endpoint</label><input value="https://middleware.internal/customs/orders" readOnly/><label>Format</label><select><option>JSON</option></select><label>Destination</label><input value="ASM UK" readOnly/></div><div className="panel settings-card"><h2>Processing defaults</h2><p>Global fallbacks used when a customer has no overriding rule.</p><Toggle label="Automatic validation" on/><Toggle label="Low-confidence review queue" on/><Toggle label="Auto-send validated packs" on/></div></div></section>}

function Toggle({label,on}){return <div className="toggle-row"><span>{label}</span><div className={"toggle "+(on?"on":"")}><i></i></div></div>}

createRoot(document.getElementById("root")).render(<App/>);
// Vercel redeploy trigger after connection reset 2026-09-18T20:26:46.067Z
