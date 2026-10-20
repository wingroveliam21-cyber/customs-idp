import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Mail,
  MoreHorizontal,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { customerStrategyStore } from "../../domain/packData.js";

const SETUP_SECTIONS=[
  {id:"details",label:"Details",icon:Settings},
  {id:"strategy",label:"Strategy",icon:ShieldCheck},
  {id:"knowledge",label:"Agent Knowledge",icon:BookOpen},
  {id:"mailbox",label:"Mailbox",icon:Mail},
  {id:"memory",label:"Memory",icon:Sparkles}
];

const DEFAULT_STRATEGY={
  instructions:"",
  requiredFields:[],
  weightHandling:"ask_user",
  emailFields:[],
  validationRules:[],
  extractionRules:[],
  fieldRules:[],
  customValidations:[],
  autoApplyWeightApportionment:false,
  sourcePriority:[],
  approvalRequirements:[]
};

function cloneStrategy(strategy){
  return {
    ...DEFAULT_STRATEGY,
    ...(strategy||{}),
    instructions:typeof strategy?.instructions==="string"?strategy.instructions:"",
    weightHandling:["ask_user","invoice","packing_list"].includes(strategy?.weightHandling)?strategy.weightHandling:"ask_user",
    emailFields:Array.isArray(strategy?.emailFields)?[...strategy.emailFields]:[],
    validationRules:Array.isArray(strategy?.validationRules)?[...strategy.validationRules]:[],
    extractionRules:Array.isArray(strategy?.extractionRules)?[...strategy.extractionRules]:[],
    requiredFields:Array.isArray(strategy?.requiredFields)?[...strategy.requiredFields]:[],
    fieldRules:Array.isArray(strategy?.fieldRules)?[...strategy.fieldRules]:[],
    customValidations:Array.isArray(strategy?.customValidations)?[...strategy.customValidations]:[],
    sourcePriority:Array.isArray(strategy?.sourcePriority)?[...strategy.sourcePriority]:[],
    approvalRequirements:Array.isArray(strategy?.approvalRequirements)?[...strategy.approvalRequirements]:[],
    autoApplyWeightApportionment:strategy?.autoApplyWeightApportionment===true
  };
}

function Customers({notify}){
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [organisation,setOrganisation]=useState(null);
  const [teamCount,setTeamCount]=useState(0);
  const [teams,setTeams]=useState([]);
  const [customerRows,setCustomerRows]=useState([]);

  const [selectedCustomer,setSelectedCustomer]=useState(null);
  const [setupSection,setSetupSection]=useState("details");

  const [form,setForm]=useState({
    name:"",
    code:"",
    teamId:""
  });

  const [strategy,setStrategy]=useState(cloneStrategy());
  const [saving,setSaving]=useState(false);
  const [setupError,setSetupError]=useState("");
  const [saved,setSaved]=useState(false);

  const [showCreate,setShowCreate]=useState(false);
  const [creating,setCreating]=useState(false);
  const [createForm,setCreateForm]=useState({
    name:"",
    code:"",
    teamId:""
  });
  const [formError,setFormError]=useState("");

  const loadCustomers=async()=>{
    setLoading(true);
    setError("");

    try{
      const response=await fetch(
        "/api/organisation?action=customers",
        {credentials:"include"}
      );

      const data=await response.json().catch(()=>({}));

      if(!response.ok){
        throw new Error(
          data.error||"Unable to load organisation customers."
        );
      }

      const rows=Array.isArray(data.customers)?data.customers:[];
      const teamRows=Array.isArray(data.teams)?data.teams:[];

      setOrganisation(data.organisation||null);
      setTeamCount(teamRows.length);
      setTeams(teamRows);
      setCustomerRows(rows);

      rows.forEach(customer=>{
        customerStrategyStore[customer.id]=cloneStrategy(customer.strategy);
      });
    }catch(e){
      setError(e.message||"Unable to load customers.");
      return false;
    }finally{
      setLoading(false);
    }
    return true;
  };

  useEffect(()=>{
    loadCustomers();
  },[]);

  const openCreate=()=>{
    setCreateForm({
      name:"",
      code:"",
      teamId:""
    });
    setFormError("");
    setShowCreate(true);
  };

  const closeCreate=()=>{
    if(creating)return;

    setShowCreate(false);
    setFormError("");
  };

  const openSetup=(customer,section="details")=>{
    setSelectedCustomer(customer);
    setSetupSection(section);

    setForm({
      name:customer.name||"",
      code:customer.code||"",
      teamId:customer.teamId||""
    });

    setStrategy(cloneStrategy(customer.strategy));
    setSetupError("");
    setSaved(false);
  };

  const closeSetup=(allowWhileSaving=false)=>{
    if(saving&&!allowWhileSaving)return;

    setSelectedCustomer(null);
    setSetupError("");
    setSaved(false);
  };

  const createCustomer=async(event)=>{
    event.preventDefault();
    setFormError("");

    const name=createForm.name.trim();
    const code=createForm.code.trim();

    if(!name){
      setFormError("Customer name is required.");
      return;
    }

    if(!code){
      setFormError("Customer code is required.");
      return;
    }

    setCreating(true);

    try{
      const response=await fetch("/api/organisation",{
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          name,
          code,
          teamId:createForm.teamId||null
        })
      });

      const data=await response.json().catch(()=>({}));

      if(!response.ok){
        throw new Error(
          data.error||"Unable to create customer."
        );
      }

      setShowCreate(false);
      setCreateForm({
        name:"",
        code:"",
        teamId:""
      });

      await loadCustomers();

      const createdCustomer={
        ...(data.customer||{}),
        strategy:data.strategy?.config||{},
        strategyVersion:data.strategy?.version||null,
        strategyStatus:data.strategy?.status||null,
        teamId:data.customer?.teamId||createForm.teamId||null
      };

      openSetup(createdCustomer,"details");

      notify(
        `${data.customer?.name||name} created successfully`
      );
    }catch(e){
      setFormError(
        e.message||"Unable to create customer."
      );
    }finally{
      setCreating(false);
    }
  };

  const saveSetup=async(strategyOverride=strategy)=>{
    if(!selectedCustomer)return;

    setSaving(true);
    setSetupError("");
    setSaved(false);

    try{
      const response=await fetch("/api/organisation",{
        method:"PUT",
        credentials:"include",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          customerId:selectedCustomer.id,
          name:form.name.trim(),
          code:form.code.trim(),
          teamId:form.teamId||null,
          strategy:strategyOverride
        })
      });

      const data=await response.json().catch(()=>({}));

      if(!response.ok){
        throw new Error(
          data.error||"Unable to save customer setup."
        );
      }

      const updatedCustomer={
        ...selectedCustomer,
        ...data.customer,
        strategy:data.strategy?.config||strategyOverride,
        strategyVersion:data.strategy?.version||selectedCustomer.strategyVersion||1,
        strategyStatus:data.strategy?.status||"active"
      };

      setSelectedCustomer(updatedCustomer);
      setStrategy(cloneStrategy(updatedCustomer.strategy));

      customerStrategyStore[updatedCustomer.id]=cloneStrategy(
        updatedCustomer.strategy
      );

      const refreshed=await loadCustomers();
      if(!refreshed)throw new Error("Customer strategy saved, but the customer list could not be refreshed.");

      setSaved(true);
      notify(`${updatedCustomer.name} strategy saved`);
      setSaving(false);
      closeSetup(true);
    }catch(e){
      setSetupError(
        e.message||"Unable to save customer setup."
      );
    }finally{
      setSaving(false);
    }
  };

  const updateStrategyArray=(key,value)=>{
    setStrategy(current=>({
      ...current,
      [key]:value
    }));
    setSaved(false);
  };

  const addStrategyItem=(key)=>{
    const labels={
      requiredFields:"Field name",
      extractionRules:"Extraction instruction",
      validationRules:"Validation rule",
      fieldRules:"Field rule",
      customValidations:"Custom validation",
      emailFields:"Email field"
    };

    updateStrategyArray(
      key,
      [...strategy[key],""]
    );
  };

  const removeStrategyItem=(key,index)=>{
    updateStrategyArray(
      key,
      strategy[key].filter((_,itemIndex)=>itemIndex!==index)
    );
  };

  const updateStrategyItem=(key,index,value)=>{
    updateStrategyArray(
      key,
      strategy[key].map((item,itemIndex)=>
        itemIndex===index?value:item
      )
    );
  };

  if(selectedCustomer){
    return <CustomerSetup
      customer={selectedCustomer}
      form={form}
      setForm={setForm}
      strategy={strategy}
      setStrategy={setStrategy}
      section={setupSection}
      setSection={setSetupSection}
      saving={saving}
      saved={saved}
      error={setupError}
      onBack={closeSetup}
      onSave={saveSetup}
      updateStrategyArray={updateStrategyArray}
      addStrategyItem={addStrategyItem}
      removeStrategyItem={removeStrategyItem}
      updateStrategyItem={updateStrategyItem}
      teams={teams}
      customerId={selectedCustomer.id}
      strategyVersion={selectedCustomer.strategyVersion}
    />;
  }

  return <section>
    <div className="page-head">
      <div>
        <div className="eyebrow">Configuration</div>
        <h1>Customers</h1>
        <p>
          Customer-specific extraction strategies, mailboxes and
          validation rules.
        </p>

        {organisation&&
          <span className="summary-kicker">
            {organisation.name} · {teamCount} team{teamCount===1?"":"s"}
          </span>
        }
      </div>

      <button
        className="primary"
        type="button"
        onClick={openCreate}
      >
        <Plus size={17}/>
        Add customer
      </button>
    </div>

    {loading&&
      <div className="panel">
        <div className="setting-status">
          Loading organisation customers…
        </div>
      </div>
    }

    {!loading&&error&&
      <div className="panel">
        <div className="password-login-error">{error}</div>
        <button
          className="secondary"
          type="button"
          onClick={loadCustomers}
        >
          Retry
        </button>
      </div>
    }

    {!loading&&!error&&
      <div className="customer-grid">
        {customerRows.map(customer=>
          <div
            className="customer-card"
            key={customer.id||customer.code}
          >
            <div className="customer-top">
              <div className="customer-logo">
                {customer.name
                  .split(" ")
                  .map(x=>x[0])
                  .slice(0,2)
                  .join("")
                }
              </div>

              <button
                className="row-btn"
                type="button"
                onClick={()=>openSetup(customer,"details")}
                title="Open customer setup"
              >
                <MoreHorizontal size={17}/>
              </button>
            </div>

            <h3>{customer.name}</h3>
            <span className="code">{customer.code}</span>

            <div className="customer-info">
              <div>
                <Mail size={15}/>
                <span>
                  {customer.mailbox||"No mailbox assigned"}
                </span>
              </div>

              <div>
                <Settings size={15}/>
                <span>
                  {customer.strategyStatus==="active"&&customer.strategyVersion
                    ?`1 strategy · v${customer.strategyVersion}`
                    :"No strategy configured"}
                </span>
              </div>

              <div>
                <Activity size={15}/>
                <span>
                  {customer.processed.toLocaleString()}
                  {" "}documents processed
                </span>
              </div>
            </div>

            <button
              className="full-btn"
              type="button"
              onClick={()=>openSetup(customer,"strategy")}
            >
              Open customer setup
              <ArrowRight size={15}/>
            </button>
          </div>
        )}
      </div>
    }

    {showCreate&&
      <div
        className="modal-backdrop"
        onMouseDown={closeCreate}
      >
        <div
          className="modal-card"
          onMouseDown={event=>event.stopPropagation()}
        >
          <div className="modal-head">
            <div>
              <div className="eyebrow">Customer setup</div>
              <h2>Create customer</h2>
              <p>
                Create the customer, then configure its complete
                setup in one workspace.
              </p>
            </div>

            <button
              className="row-btn"
              type="button"
              onClick={closeCreate}
              disabled={creating}
            >
              <X size={18}/>
            </button>
          </div>

          <form onSubmit={createCustomer}>
            <label className="field">
              <span>Customer name <strong>*</strong></span>

              <input
                value={createForm.name}
                onChange={event=>
                  setCreateForm({
                    ...createForm,
                    name:event.target.value
                  })
                }
                placeholder="e.g. Acme Components Ltd"
                autoFocus
                disabled={creating}
              />
            </label>

            <label className="field">
              <span>Customer code <strong>*</strong></span>

              <input
                value={createForm.code}
                onChange={event=>
                  setCreateForm({
                    ...createForm,
                    code:event.target.value
                  })
                }
                placeholder="e.g. ACME"
                disabled={creating}
              />

              <small>
                Use a short internal identifier for the customer.
              </small>
            </label>

            <label className="field">
              <span>Team</span>

              <select
                value={createForm.teamId}
                onChange={event=>
                  setCreateForm({
                    ...createForm,
                    teamId:event.target.value
                  })
                }
                disabled={creating}
              >
                <option value="">No team assigned</option>

                {teams.map(team=>
                  <option
                    key={team.id}
                    value={team.id}
                  >
                    {team.name}
                  </option>
                )}
              </select>
            </label>

            {formError&&
              <div className="password-login-error">
                {formError}
              </div>
            }

            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                onClick={closeCreate}
                disabled={creating}
              >
                Cancel
              </button>

              <button
                className="primary"
                type="submit"
                disabled={creating}
              >
                {creating
                  ?"Creating…"
                  :"Create & configure"
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  </section>;
}

function CustomerSetup({
  customer,
  form,
  setForm,
  strategy,
  setStrategy,
  section,
  setSection,
  saving,
  saved,
  error,
  onBack,
  onSave,
  updateStrategyArray,
  addStrategyItem,
  removeStrategyItem,
  updateStrategyItem,
  teams,
  customerId,
  strategyVersion
}){
  return <section className="customer-setup">
    <div className="customer-setup-header">
      <div className="customer-setup-heading">
        <button
          className="back-link customer-setup-back"
          type="button"
          onClick={onBack}
          disabled={saving}
        >
          <ArrowLeft size={16}/>
          Back to customers
        </button>

        <div className="customer-setup-title-row">
          <div className="customer-logo">
            {String(form.name||customer.name).split(" ").map(x=>x[0]).slice(0,2).join("")}
          </div>
          <div>
            <div className="eyebrow">Customer Setup</div>
            <h1>{form.name||customer.name}</h1>
            <div className="customer-setup-meta">
              <span>{form.code||customer.code}</span>
              <span className="active-status"><i/>Active</span>
            </div>
          </div>
        </div>
      </div>

      <div className="setup-actions">
        {saved&&
          <span className="saved-indicator">
            <Check size={15}/>
            Saved
          </span>
        }

        <button
          className="primary"
          type="button"
          onClick={()=>onSave()}
          disabled={saving}
        >
          <Save size={16}/>
          {saving?"Saving…":"Save changes"}
        </button>
      </div>
    </div>

    <div className="setup-tabs" role="tablist" aria-label="Customer setup sections">
          {SETUP_SECTIONS.map(item=>{
            const Icon=item.icon;
            const active=item.id===section;

            return <button
              key={item.id}
              className={`setup-nav-item${active?" active":""}`}
              type="button"
              onClick={()=>setSection(item.id)}
            >
              <Icon size={17}/>
              <span>{item.label}</span>

              {item.id==="strategy"&&
                <span className="setup-nav-count">
                  {countStrategyRules(strategy)}
                </span>
              }
            </button>;
          })}
    </div>

    <main className="customer-setup-content">
        {section==="details"&&
          <DetailsSection
            form={form}
            setForm={setForm}
            teams={teams}
          />
        }

        {section==="strategy"&&
          <StrategySection
            customer={customer}
            strategy={strategy}
            setStrategy={setStrategy}
            customerId={customerId}
            strategyVersion={strategyVersion}
            addStrategyItem={addStrategyItem}
            removeStrategyItem={removeStrategyItem}
            updateStrategyItem={updateStrategyItem}
          />
        }

        {section==="knowledge"&&
          <PlaceholderSection
            icon={BookOpen}
            title="Agent Knowledge"
            description="Customer-specific processing knowledge will live here."
            items={[
              "Document patterns",
              "Customer-specific instructions",
              "Known document terminology",
              "Processing guidance"
            ]}
          />
        }

        {section==="mailbox"&&
          <PlaceholderSection
            icon={Mail}
            title="Mailbox"
            description="Customer email routing and mailbox configuration will live here."
            items={[
              "Customer mailbox",
              "Incoming email routing",
              "Outlook connection",
              "Attachment processing"
            ]}
          />
        }

        {section==="memory"&&
          <PlaceholderSection
            icon={Sparkles}
            title="Memory"
            description="Confirmed customer-specific knowledge and learning history will live here."
            items={[
              "Confirmed knowledge",
              "Learned processing behaviour",
              "Source pack",
              "Confidence and audit history"
            ]}
          />
        }

        {error&&
          <div className="password-login-error setup-error">
            {error}
          </div>
        }
    </main>
  </section>;
}

function DetailsSection({form,setForm,teams}){
  return <div className="setup-section">
    <div className="setup-section-head">
      <div>
        <div className="eyebrow">Customer identity</div>
        <h2>Details</h2>
        <p>
          These details identify the persistent customer record
          used throughout the platform.
        </p>
      </div>
    </div>

    <div className="setup-form-grid">
      <label className="field">
        <span>Customer name <strong>*</strong></span>

        <input
          value={form.name}
          onChange={event=>
            setForm({
              ...form,
              name:event.target.value
            })
          }
        />
      </label>

      <label className="field">
        <span>Customer code <strong>*</strong></span>

        <input
          value={form.code}
          onChange={event=>
            setForm({
              ...form,
              code:event.target.value
            })
          }
        />

        <small>
          Short internal identifier used by the organisation.
        </small>
      </label>

      <label className="field">
        <span>Team</span>

        <select
          value={form.teamId}
          onChange={event=>
            setForm({
              ...form,
              teamId:event.target.value
            })
          }
        >
          <option value="">No team assigned</option>

          {teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
    </div>

    <div className="setup-info-card">
      <Settings size={18}/>

      <div>
        <strong>Customer identity is persistent</strong>

        <p>
          The customer UUID is the permanent identity used to
          associate packs, strategies, mailboxes and future
          customer memory.
        </p>
      </div>
    </div>
  </div>;
}

function StrategyReadableCard({title="Strategy summary",strategy}){
  const requiredFields=Array.isArray(strategy?.requiredFields)?strategy.requiredFields:[];
  const instructions=String(strategy?.instructions||"").trim();

  return (
    <div className="strategy-v1-card strategy-summary-card">
      <div className="strategy-v1-card-head">
        <div>
          <strong>{title}</strong>
          <span>What the system will apply when processing this customer's documents.</span>
        </div>
      </div>

      <div className="strategy-summary-items">
        <div>
          <strong>Processing</strong>
          <span>{instructions||"Standard processing rules will be used for this customer."}</span>
        </div>

        <div>
          <strong>Required information</strong>
          <span>{requiredFields.length?requiredFields.join(", "):"No additional customer-specific information required."}</span>
        </div>
      </div>
    </div>
  );
}

function StrategySection({
  customer,
  strategy,
  setStrategy,
  customerId,
  strategyVersion,
  addStrategyItem,
  removeStrategyItem,
  updateStrategyItem
}){
  const [prompt,setPrompt]=useState("");
  const [messages,setMessages]=useState([]);
  const [activeProposal,setActiveProposal]=useState(null);
  const [agentError,setAgentError]=useState("");
  const [asking,setAsking]=useState(false);
  const historyRef=useRef(null);
  const version=Number(strategyVersion);

  const askAgent=async()=>{
    if(!prompt.trim())return;
    const question=prompt.trim();
    const userMessage={type:"user",text:question};
    const conversation=[...messages,userMessage];
    setAsking(true);setAgentError("");setActiveProposal(null);setMessages(conversation);setPrompt("");
    try{
      const response=await fetch("/api/agent",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          message:question,
          pack:{
            type:"customer_strategy",
            id:customerId,
            customerId,
            customer:customer?.name||"Customer",
            customerContext:customer||null,
            customerStrategy:strategy,
            conversation:conversation.slice(-12)
          }
        })
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to ask the Agent.");
      if(data.action!=="strategy_proposal"||!data.strategyProposal?.resultingStrategy){
        setMessages(current=>[...current,{type:"agent",text:data.reply||"The Agent needs more detail before it can propose a strategy change."}]);
      }else{
        setActiveProposal(data.strategyProposal);
        setMessages(current=>[...current,{type:"agent",text:data.reply||"I've prepared a strategy change for your review.",proposal:data.strategyProposal}]);
      }
    }catch(error){
      const text=error.message||"Unable to ask the Agent.";
      setAgentError(text);
      setMessages(current=>[...current,{type:"agent",text:"I couldn't reach the strategy Agent. "+text}]);
    }finally{setAsking(false);}
  };

  useEffect(()=>{
    if(historyRef.current)historyRef.current.scrollTop=historyRef.current.scrollHeight;
  },[messages,activeProposal]);

  const applyProposal=()=>{
    if(!activeProposal)return;
    const next=activeProposal.resultingStrategy;
    setStrategy(next);
    setActiveProposal(null);
    setMessages(current=>[...current,{type:"agent",text:"Strategy changes applied. Review them and click Save changes when you're ready."}]);
  };

  const requiredFields=Array.isArray(strategy.requiredFields)?strategy.requiredFields:[];

  return <div className="setup-section">
    <div className="setup-section-head">
      <div>
        <div className="eyebrow">Customer processing</div>
        <h2>Customer Strategy</h2>
        <p>Keep V1 simple: tell the system what matters for this customer and how to handle weight differences.</p>
      </div>
      <span className="strategy-version">{version>0?"Strategy v"+version:"No strategy configured"}</span>
    </div>

    <div className="strategy-v1-grid">
      <div className="strategy-v1-main">
        <div className="strategy-v1-card">
          <div className="strategy-v1-card-head">
            <div>
              <strong>Customer processing instructions</strong>
              <span>These instructions are added to the customer prompt sent to the document extraction workflow.</span>
            </div>
          </div>
          <textarea
            className="strategy-v1-textarea"
            value={strategy.instructions||""}
            onChange={event=>setStrategy(current=>({...current,instructions:event.target.value}))}
            placeholder="Example: This customer normally provides weights on the packing list. Use those weights when the invoice does not contain weights."
            rows={7}
          />
        </div>

        <div className="strategy-v1-card">
          <div className="strategy-v1-card-head">
            <div>
              <strong>Document source priority</strong>
              <span>When documents conflict, the first document type in this list wins for supported top-level fields. Use document type IDs such as commercial_invoice and packing_list.</span>
            </div>
          </div>
          <input
            className="strategy-v1-textarea"
            value={(strategy.sourcePriority||[]).join(", ")}
            onChange={event=>setStrategy(current=>({...current,sourcePriority:event.target.value.split(",").map(value=>value.trim()).filter(Boolean)}))}
            placeholder="e.g. packing_list, commercial_invoice"
            aria-label="Document source priority"
          />
        </div>

        <div className="strategy-v1-card">
          <div className="strategy-v1-card-head">
            <div>
              <strong>Customer-specific approval requirements</strong>
              <span>Approval rules are stored as structured requirements. Each requirement should identify the action or field requiring approval.</span>
            </div>
          </div>
          <textarea
            className="strategy-v1-textarea"
            value={(strategy.approvalRequirements||[]).map(rule=>typeof rule==="string"?rule:JSON.stringify(rule)).join("\n")}
            onChange={event=>setStrategy(current=>({...current,approvalRequirements:event.target.value.split("\n").map(value=>value.trim()).filter(Boolean).map(value=>{try{return JSON.parse(value);}catch{return value;}})}))}
            placeholder={'One JSON rule per line, e.g. {"action":"set_field","field":"deliveryTerm","required":true}'}
            rows={3}
            aria-label="Customer-specific approval requirements"
          />
        </div>

        <div className="strategy-v1-card">
          <div className="strategy-v1-card-head">
            <div>
              <strong>Required information</strong>
              <span>Fields the customer normally needs to provide. Missing values are handled by the standard validation workflow.</span>
            </div>
            <button className="secondary" type="button" onClick={()=>addStrategyItem("requiredFields")}><Plus size={14}/> Add field</button>
          </div>
          <div className="strategy-v1-list">
            {!requiredFields.length&&<div className="strategy-v1-empty">No customer-specific required fields yet.</div>}
            {requiredFields.map((value,index)=>
              <div className="strategy-v1-list-row" key={index}>
                <input value={typeof value==="string"?value:""} onChange={event=>updateStrategyItem("requiredFields",index,event.target.value)} placeholder="e.g. invoiceNumber"/>
                <button className="row-btn" type="button" title="Remove field" onClick={()=>removeStrategyItem("requiredFields",index)}><Trash2 size={15}/></button>
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="strategy-v1-bottom">
        <StrategyReadableCard title="Strategy summary" strategy={strategy}/>

        <aside className="strategy-v1-agent">
        <div className="strategy-v1-agent-head">
          <div className="agent-title">
            <div className="agent-orb"><Sparkles size={18}/></div>
            <div><b>Customer Agent</b><span>{customer?.name||"Customer"} context</span></div>
          </div>
        </div>
        <div className="strategy-v1-agent-context">
          <div><span>Customer</span><strong>{customer?.name||"—"}</strong></div>
          <div><span>Code</span><strong>{customer?.code||"—"}</strong></div>
          <div><span>Team</span><strong>{customer?.teamName||"No team assigned"}</strong></div>
          <div><span>Mailbox</span><strong>{customer?.mailbox||"No mailbox assigned"}</strong></div>
          <div><span>Documents processed</span><strong>{Number(customer?.processed||0).toLocaleString()}</strong></div>
        </div>

        <div ref={historyRef} className="strategy-v1-agent-history">
          {!messages.length&&<div className="strategy-chat-welcome"><Sparkles size={22}/><strong>Ask about this customer</strong><span>The Agent can see the customer profile and current strategy.</span></div>}
          {messages.map((message,index)=>
            <div className={"chat-message-row "+message.type} key={index}>
              <div className="chat-message-avatar">{message.type==="user"?"You":<Sparkles size={15}/>}</div>
              <div className="chat-message-content">
                <div className="chat-message-text">{message.text}</div>
                {message.proposal&&activeProposal===message.proposal&&
                  <div className="strategy-chat-proposal">
                    <div className="strategy-change-list">
                      {message.proposal.changes.map((change,changeIndex)=><div key={changeIndex}><Check size={16}/><span>{change.after}</span></div>)}
                    </div>
                    <p>Would you like me to apply this strategy?</p>
                    <div className="strategy-proposal-actions">
                      <button className="secondary" type="button" onClick={()=>setActiveProposal(null)}>Cancel</button>
                      <button className="primary" type="button" onClick={applyProposal}>Apply strategy</button>
                    </div>
                  </div>
                }
              </div>
            </div>
          )}
          {asking&&<div className="chat-message-row agent"><div className="chat-message-avatar"><Sparkles size={15}/></div><div className="chat-message-content"><div className="chat-message-text">I'm thinking through this customer's strategy…</div></div></div>}
        </div>

        <div className="chat-input strategy-chat-input">
          <input value={prompt} onChange={event=>setPrompt(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();askAgent();}}} placeholder="Ask the Agent to change the strategy…"/>
          <button type="button" onClick={askAgent} disabled={asking||!prompt.trim()} aria-label="Send strategy request"><ArrowRight size={16}/></button>
        </div>
        {agentError&&<div className="strategy-agent-message">{agentError}</div>}
        </aside>
      </div>
    </div>
  </div>;
}

function StrategyRuleGroup({
  group,
  values,
  addItem,
  removeItem,
  updateItem
}){
  return <div className="strategy-rule-group">
    <div className="strategy-rule-head">
      <div>
        <h3>{group.title}</h3>
        <p>{group.description}</p>
      </div>

      <button
        className="secondary"
        type="button"
        onClick={addItem}
      >
        <Plus size={15}/>
        Add
      </button>
    </div>

    {values.length===0&&
      <div className="empty-rule">
        <div className="empty-rule-icon"><Sparkles size={17}/></div>
        <strong>No {group.title.toLowerCase()} yet</strong>
        <span>Add a rule to tell the IDP agent how this customer's documents should be interpreted.</span>
        <button className="secondary" type="button" onClick={addItem}>
          <Plus size={15}/> Add {group.title.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    }

    {values.map((value,index)=>
      <div
        className="strategy-rule-row"
        key={`${group.key}-${index}`}
      >
        <input
          value={
            typeof value==="string"
              ?value
              :JSON.stringify(value)
          }
          onChange={event=>
            updateItem(
              index,
              event.target.value
            )
          }
          placeholder={
            group.key==="requiredFields"
              ?"e.g. invoiceNumber"
              :"Describe the customer rule"
          }
        />

        <button
          className="row-btn rule-delete"
          type="button"
          onClick={()=>removeItem(index)}
          title="Remove rule"
        >
          <Trash2 size={15}/>
        </button>
      </div>
    )}
  </div>;
}

function PlaceholderSection({
  icon:Icon,
  title,
  description,
  items
}){
  return <div className="setup-section">
    <div className="setup-section-head">
      <div>
        <div className="eyebrow">Customer configuration</div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>

    <div className="setup-placeholder-grid">
      {items.map(item=>
        <div
          className="setup-placeholder-card"
          key={item}
        >
          <Icon size={18}/>
          <div>
            <strong>{item}</strong>
            <span>Configuration will be added here.</span>
          </div>
        </div>
      )}
    </div>

    <div className="setup-info-card">
      <Sparkles size={18}/>

      <div>
        <strong>Designed for Agent-assisted setup</strong>

        <p>
          The Inbox Agent will eventually be able to take natural
          language instructions from the user and propose
          configuration here for confirmation.
        </p>
      </div>
    </div>
  </div>;
}

function countStrategyRules(strategy){
  if(!strategy||typeof strategy!=="object")return 0;

  const hasInstructions=String(strategy.instructions||"").trim().length>0;
  const hasRequiredFields=Array.isArray(strategy.requiredFields)
    && strategy.requiredFields.some(Boolean);

  return hasInstructions||hasRequiredFields?1:0;
}

export { Customers };
