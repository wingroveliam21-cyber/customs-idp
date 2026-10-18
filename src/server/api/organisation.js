import { requireAuth } from "./authGuard.js";

export default async function handler(req,res){
  const auth=requireAuth(req,res);
  if(!auth)return;

  if(req.method==="POST"){
    const action=String(req.body?.action||"").toLowerCase();
    if(action==="confirm-customer-memory")return confirmCustomerMemory(req,res,auth);
    return createCustomer(req,res,auth);
  }

  if(req.method==="PUT"){
    return updateCustomer(req,res,auth);
  }

  if(req.method!=="GET"){
    return res.status(405).json({error:"Method not allowed"});
  }

  const action=String(req.query?.action||"summary").toLowerCase();

  if(!["summary","customers","teams"].includes(action)){
    return res.status(400).json({error:"Unknown organisation action"});
  }

  try{
    const organisationId=auth.organisationId;

    const organisationRows=await supabaseFetch(
      `organisations?id=eq.${encodeURIComponent(organisationId)}&select=id,name,status&limit=1`
    );

    const organisation=organisationRows?.[0];

    if(!organisation||organisation.status!=="active"){
      return res.status(403).json({error:"Organisation is not configured."});
    }

    const [teams,customers,strategies,mailboxes,packs,memories]=await Promise.all([
      supabaseFetch(
        `teams?organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,name,status&order=name.asc`
      ),
      supabaseFetch(
        `customers?organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,name,code,status,team_id&order=name.asc`
      ),
      supabaseFetch(
        `customer_strategies?organisation_id=eq.${encodeURIComponent(organisationId)}&status=eq.active&select=id,customer_id,version,status,config,updated_at&order=version.desc`
      ),
      supabaseFetch(
        `mailboxes?organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,address,status,provider,customer_id,team_id&order=address.asc`
      ),
      supabaseFetch(
        `document_packs?organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,customer,customer_id`
      ),
      supabaseFetch(
        `customer_memory?organisation_id=eq.${encodeURIComponent(organisationId)}&memory_type=eq.customer_alias&select=customer_id,source_value,normalized_value&order=created_at.asc`
      )
    ]);

    const strategyByCustomerId={};

    for(const strategy of strategies){
      if(!strategyByCustomerId[strategy.customer_id]){
        strategyByCustomerId[strategy.customer_id]=strategy;
      }
    }

    const mailboxByCustomerId={};

    for(const mailbox of mailboxes){
      if(mailbox.customer_id&&!mailboxByCustomerId[mailbox.customer_id]){
        mailboxByCustomerId[mailbox.customer_id]=mailbox;
      }
    }

    const processedByCustomer={};

    for(const pack of packs){
      if(pack.customer_id){
        processedByCustomer[pack.customer_id]=
          (processedByCustomer[pack.customer_id]||0)+1;
      }
    }

    const memoryAliasesByCustomerId={};
    for(const memory of memories){
      if(!memoryAliasesByCustomerId[memory.customer_id]){
        memoryAliasesByCustomerId[memory.customer_id]=[];
      }
      memoryAliasesByCustomerId[memory.customer_id].push(memory.source_value);
    }

    const resultCustomers=customers.map(customer=>{
      const strategy=strategyByCustomerId[customer.id];
      const mailbox=mailboxByCustomerId[customer.id]||null;

      return {
        id:customer.id,
        name:customer.name,
        code:customer.code,
        status:customer.status,
        teamId:customer.team_id||null,
        teamName:teams.find(team=>team.id===customer.team_id)?.name||null,
        mailbox:mailbox?.address||null,
        mailboxStatus:mailbox?.status||null,
        mailboxProvider:mailbox?.provider||null,
        strategyId:strategy?.id||null,
        strategyVersion:strategy?.version||null,
        strategyStatus:strategy?.status||null,
        strategy:strategy?.config||{},
        memoryAliases:memoryAliasesByCustomerId[customer.id]||[],
        rules:countStrategyRules(strategy?.config),
        processed:processedByCustomer[customer.id]||0
      };
    });

    return res.status(200).json({
      organisation:{
        id:organisation.id,
        name:organisation.name,
        status:organisation.status
      },
      teams,
      customers:resultCustomers,
      strategies,
      mailboxes
    });
  }catch(error){
    return res.status(503).json({
      error:error.message||"Unable to load organisation data."
    });
  }
}

async function confirmCustomerMemory(req,res,auth){try{const body=parseBody(req);const customerId=String(body.customerId||"").trim();const sourceValue=String(body.sourceValue||"").trim();const sourceType=String(body.sourceType||"exporter").trim();if(!customerId||!sourceValue)return res.status(400).json({error:"Customer ID and source value are required."});const rows=await supabaseFetch("customers?organisation_id=eq."+encodeURIComponent(auth.organisationId)+"&id=eq."+encodeURIComponent(customerId)+"&status=eq.active&select=id,name,code,status&limit=1");const customer=rows?.[0];if(!customer)return res.status(404).json({error:"Customer not found."});const normalise=value=>String(value||"").trim().toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();const memory=await supabaseFetch("customer_memory",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({organisation_id:auth.organisationId,customer_id:customer.id,memory_type:"customer_alias",source_value:sourceValue,normalized_value:normalise(sourceValue),created_by:auth.userId||auth.email||null,metadata:{sourceType}})});return res.status(200).json({ok:true,memory:memory?.[0]||null,customer:{id:customer.id,name:customer.name,code:customer.code,status:customer.status}});}catch(error){return res.status(503).json({error:error.message||"Unable to save customer memory."});}}

async function createCustomer(req,res,auth){
  try{
    if(!["manager","admin"].includes(String(auth.role||"").toLowerCase())){
      return res.status(403).json({error:"Manager or admin access required."});
    }

    const body=parseBody(req);

    const name=String(body.name||"").trim();
    const teamId=String(body.teamId||"").trim()||null;

    if(!name){
      return res.status(400).json({error:"Customer name is required."});
    }

    const organisationId=auth.organisationId;

    const existing=await supabaseFetch(
      `customers?organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,name,code,status`
    );

    const normalise=value=>String(value||"").trim().toLowerCase();

    if(existing.some(customer=>normalise(customer.name)===normalise(name))){
      return res.status(409).json({
        error:"A customer with this name already exists."
      });
    }

    const baseCode=name
      .replace(/&/g," and ")
      .replace(/[^a-zA-Z0-9]+/g," ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter(word=>!["ltd","limited","llp","plc","inc","incorporated","corp","corporation","gmbh","co","company"].includes(word.toLowerCase()))
      .join("-")
      .toUpperCase()
      .slice(0,40) || "CUSTOMER";

    let code=baseCode;
    let suffix=2;

    while(existing.some(customer=>normalise(customer.code)===normalise(code))){
      const suffixText=`-${suffix}`;
      code=`${baseCode.slice(0,40-suffixText.length)}${suffixText}`;
      suffix+=1;
    }

    if(teamId){
      const teams=await supabaseFetch(
        `teams?organisation_id=eq.${encodeURIComponent(organisationId)}&id=eq.${encodeURIComponent(teamId)}&select=id&limit=1`
      );

      if(!teams?.[0]){
        return res.status(400).json({
          error:"Selected team does not belong to this organisation."
        });
      }
    }

    const customers=await supabaseFetch(
      "customers",
      {
        method:"POST",
        headers:{
          Prefer:"return=representation"
        },
        body:JSON.stringify({
          organisation_id:organisationId,
          team_id:teamId,
          name,
          code,
          status:"active"
        })
      }
    );

    const customer=customers?.[0];

    if(!customer?.id){
      throw new Error("Customer was created but no customer ID was returned.");
    }

    return res.status(201).json({
      customer:{
        id:customer.id,
        name:customer.name,
        code:customer.code,
        status:customer.status,
        teamId:customer.team_id||null
      },
      strategy:null
    });
  }catch(error){
    const message=error?.message||"Unable to create customer.";

    if(message.includes("customers_organisation_id_code_key")){
      return res.status(409).json({
        error:"A customer with this code already exists."
      });
    }

    return res.status(503).json({error:message});
  }
}

async function updateCustomer(req,res,auth){
  try{
    const body=parseBody(req);
    const strategyOnly=body.strategy!==undefined&&body.name===undefined&&body.code===undefined&&body.teamId===undefined;
    if(!strategyOnly&&!["manager","admin"].includes(String(auth.role||"").toLowerCase())){
      return res.status(403).json({
        error:"Manager or admin access required to change customer details."
      });
    }

    const customerId=String(body.customerId||"").trim();

    if(!customerId){
      return res.status(400).json({
        error:"Customer ID is required."
      });
    }

    const organisationId=auth.organisationId;

    const customers=await supabaseFetch(
      `customers?organisation_id=eq.${encodeURIComponent(organisationId)}&id=eq.${encodeURIComponent(customerId)}&select=id,name,code,status,team_id&limit=1`
    );

    const customer=customers?.[0];

    if(!customer){
      return res.status(404).json({
        error:"Customer not found."
      });
    }

    if(body.name!==undefined||body.code!==undefined||body.teamId!==undefined){
      const updates={};

      if(body.name!==undefined){
        const name=String(body.name||"").trim();

        if(!name){
          return res.status(400).json({
            error:"Customer name is required."
          });
        }

        updates.name=name;
      }

      if(body.code!==undefined){
        const code=String(body.code||"").trim();

        if(!code){
          return res.status(400).json({
            error:"Customer code is required."
          });
        }

        updates.code=code;
      }

      if(body.teamId!==undefined){
        const teamId=String(body.teamId||"").trim()||null;

        if(teamId){
          const teams=await supabaseFetch(
            `teams?organisation_id=eq.${encodeURIComponent(organisationId)}&id=eq.${encodeURIComponent(teamId)}&select=id&limit=1`
          );

          if(!teams?.[0]){
            return res.status(400).json({
              error:"Selected team does not belong to this organisation."
            });
          }
        }

        updates.team_id=teamId;
      }

      if(Object.keys(updates).length){
        const updatedCustomers=await supabaseFetch(
          `customers?id=eq.${encodeURIComponent(customerId)}&organisation_id=eq.${encodeURIComponent(organisationId)}`,
          {
            method:"PATCH",
            headers:{
              Prefer:"return=representation"
            },
            body:JSON.stringify(updates)
          }
        );

        if(updatedCustomers?.[0]){
          Object.assign(customer,updatedCustomers[0]);
        }
      }
    }

    let strategy=null;

    if(body.strategy!==undefined){
      const config=normaliseStrategyConfig(body.strategy);

      const activeStrategies=await supabaseFetch(
        `customer_strategies?organisation_id=eq.${encodeURIComponent(organisationId)}&customer_id=eq.${encodeURIComponent(customerId)}&status=eq.active&select=id,customer_id,version,status,config,updated_at&order=version.desc&limit=1`
      );

      const current=activeStrategies?.[0]||null;
      const nextVersion=(Number(current?.version)||0)+1;

      if(current){
        await supabaseFetch(
          `customer_strategies?id=eq.${encodeURIComponent(current.id)}&organisation_id=eq.${encodeURIComponent(organisationId)}`,
          {
            method:"PATCH",
            headers:{
              Prefer:"return=representation"
            },
            body:JSON.stringify({
              status:"archived"
            })
          }
        );
      }

      const created=await supabaseFetch(
        "customer_strategies",
        {
          method:"POST",
          headers:{
            Prefer:"return=representation"
          },
          body:JSON.stringify({
            organisation_id:organisationId,
            customer_id:customerId,
            version:nextVersion,
            status:"active",
            config
          })
        }
      );

      strategy=created?.[0]||null;
    }else{
      const strategies=await supabaseFetch(
        `customer_strategies?organisation_id=eq.${encodeURIComponent(organisationId)}&customer_id=eq.${encodeURIComponent(customerId)}&status=eq.active&select=id,customer_id,version,status,config,updated_at&order=version.desc&limit=1`
      );

      strategy=strategies?.[0]||null;
    }

    return res.status(200).json({
      customer:{
        id:customer.id,
        name:customer.name,
        code:customer.code,
        status:customer.status,
        teamId:customer.team_id||null
      },
      strategy:{
        id:strategy?.id||null,
        version:strategy?.version||null,
        status:strategy?.status||null,
        config:strategy?.config||{}
      }
    });
  }catch(error){
    const message=error?.message||"Unable to update customer.";

    if(
      message.includes("customers_organisation_id_code_key")||
      message.includes("duplicate key")
    ){
      return res.status(409).json({
        error:"A customer with this code already exists."
      });
    }

    return res.status(503).json({error:message});
  }
}

function createDefaultStrategy(){
  return {
    instructions:"",
    requiredFields:[],
    weightHandling:"ask_user",
    emailFields:[],
    validationRules:[],
    extractionRules:[],
    fieldRules:[],
    customValidations:[],
    autoApplyWeightApportionment:false,
    lineCurrencyFromHeader:false,
    totalInvoiceFromLines:false,
    exporterAddress:"",
    importerAddress:""
  };
}

function normaliseStrategyConfig(value){
  const config=value&&typeof value==="object"?value:{};
  const defaultConfig=createDefaultStrategy();

  return {
    ...defaultConfig,
    ...config,
    instructions:typeof config.instructions==="string"?config.instructions:"",
    weightHandling:["ask_user","invoice","packing_list"].includes(config.weightHandling)?config.weightHandling:"ask_user",
    emailFields:Array.isArray(config.emailFields)?config.emailFields:[],
    validationRules:Array.isArray(config.validationRules)?config.validationRules:[],
    extractionRules:Array.isArray(config.extractionRules)?config.extractionRules:[],
    requiredFields:Array.isArray(config.requiredFields)?config.requiredFields:[],
    fieldRules:Array.isArray(config.fieldRules)?config.fieldRules:[],
    customValidations:Array.isArray(config.customValidations)?config.customValidations:[],
    autoApplyWeightApportionment:config.autoApplyWeightApportionment===true,
    lineCurrencyFromHeader:config.lineCurrencyFromHeader===true,
    totalInvoiceFromLines:config.totalInvoiceFromLines===true,
    exporterAddress:typeof config.exporterAddress==="string"?config.exporterAddress:"",
    importerAddress:typeof config.importerAddress==="string"?config.importerAddress:""
  };
}

function parseBody(req){
  if(typeof req.body==="object"&&req.body){
    return req.body;
  }

  try{
    return JSON.parse(req.body||"{}");
  }catch{
    return {};
  }
}

function countStrategyRules(config){
  if(!config||typeof config!=="object")return 0;

  const ruleKeys=["instructions","requiredFields","weightHandling"];

  return ruleKeys.reduce((count,key)=>{
    const value=config[key];

    if(Array.isArray(value)){
      return count+value.filter(Boolean).length;
    }

    if(value&&typeof value==="object"){
      return count+Object.keys(value).length;
    }

    return count;
  },0);
}

async function supabaseFetch(path,options={}){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;

  if(!url||!key){
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel."
    );
  }

  const response=await fetch(`${url}/rest/v1/${path}`,{
    ...options,
    headers:{
      apikey:key,
      Authorization:`Bearer ${key}`,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });

  if(!response.ok){
    throw new Error(await response.text());
  }

  const text=await response.text();
  return text?JSON.parse(text):[];
}
