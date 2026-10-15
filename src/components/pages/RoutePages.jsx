"use client";

import React, { useState } from "react";
import { AgentPage } from "./AgentPage.jsx";
import { Customers } from "./CustomersPage.jsx";
import { ManagerPage } from "./DashboardPages.jsx";
import { InboxPage } from "./InboxPage.jsx";
import { Review, SettingsPage } from "./Pages.jsx";
import { ProcessingReviewGuard } from "../ProcessingReviewGuard.jsx";
import { useWorkspace } from "../../App.jsx";

function InboxRoute(){
  const { livePacks, currentUser, currentUserName, openPack, handleUpload, assignPack, deletePack, packLoadError, packsLoading }=useWorkspace();
  const [query,setQuery]=useState("");
  const filteredPacks=livePacks.filter(pack=>[pack.customer,pack.status,pack.ticket,pack.uploadedFiles?.[0]?.name,pack.email?.subject].join(" ").toLowerCase().includes(query.toLowerCase()));
  return <InboxPage key={currentUser?.id||currentUserName} packs={filteredPacks} packsLoading={packsLoading} query={query} setQuery={setQuery} openPack={openPack} onUpload={handleUpload} onAssign={assignPack} onDelete={deletePack} currentUserKey={currentUser?.id||currentUserName} packLoadError={packLoadError}/>;
}

function PackNotFound(){
  const { navigate }=useWorkspace();
  return <section><div className="panel settings-card"><div className="eyebrow">Inbox</div><h1>Pack not found</h1><p>This pack is unavailable or you do not have access to it.</p><button type="button" className="primary" onClick={()=>navigate("inbox")}>Back to inbox</button></div></section>;
}

function AccessDenied(){
  const { navigate }=useWorkspace();
  return <section><div className="panel settings-card"><div className="eyebrow">Manager</div><h1>Access restricted</h1><p>This area is available to organisation managers and admins.</p><button type="button" className="primary" onClick={()=>navigate("inbox")}>Back to inbox</button></div></section>;
}

function ReviewRoute(){
  const { selectedPack, packsLoading, currentUserName, navigate, notify, assignPack, updatePack, validatePack, postToLCA, reprocessPack, persistPack, persistValidatedPack, recordHistory }=useWorkspace();
  if(packsLoading&&!selectedPack)return <section><div className="panel settings-card"><h1>Loading pack…</h1><p>Loading the selected document pack.</p></div></section>;
  if(!selectedPack)return <PackNotFound/>;
  return selectedPack.status==="Processing"&&!selectedPack.processingError
    ? <ProcessingReviewGuard onBack={()=>navigate("inbox")}/>
    : <Review pack={{...selectedPack,workingRecord:selectedPack.workingRecord}} currentUserName={currentUserName} back={()=>navigate("inbox")} notify={notify} onAssign={assignPack} updatePack={updatePack} validatePack={validatePack} postToLCA={postToLCA} reprocessPack={reprocessPack} persistPack={persistPack} persistValidatedPack={persistValidatedPack} recordHistory={recordHistory}/>;
}

function ManagerRoute(){
  const { livePacks, dataSource, canViewManager }=useWorkspace();
  return canViewManager?<ManagerPage livePacks={livePacks} dataSource={dataSource}/>:<AccessDenied/>;
}

function CustomersRoute(){
  const { notify }=useWorkspace();
  return <Customers notify={notify}/>;
}

function AgentRoute(){return <AgentPage/>;}

function SettingsRoute(){
  const { currentUserRole }=useWorkspace();
  return <SettingsPage currentUserRole={currentUserRole}/>;
}

export { InboxRoute, ReviewRoute, ManagerRoute, CustomersRoute, AgentRoute, SettingsRoute };
