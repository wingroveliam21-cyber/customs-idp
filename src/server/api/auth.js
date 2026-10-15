import { clearAuthCookie, createAuthCookie, getAuthContext } from "./authGuard.js";

const LOCAL_TEST_USERS={
  liam:{id:"local-liam",email:"liam@example.test",name:"Liam Wingrove",role:"manager"},
  muhammad:{id:"local-muhammad",email:"muhammad@example.test",name:"Muhammad Amer",role:"manager"},
  processor1:{id:"local-processor-1",email:"processor1@example.test",name:"Data Processor 1",role:"member"},
  processor2:{id:"local-processor-2",email:"processor2@example.test",name:"Data Processor 2",role:"member"}
};

export default async function handler(req,res){res.setHeader("X-Customs-IDP-Auth-Route","pages-api-v1");
  if(req.method==="POST"&&req.query?.mode==="local-test"){
    if(!isLocalTestRequest(req))return res.status(404).json({error:"Not found"});
    const user=LOCAL_TEST_USERS[String(req.body?.userId||"liam")];
    if(!user)return res.status(400).json({error:"Unknown local test user."});
    const context={...user,organisationId:"demo-organisation"};
    res.setHeader("Set-Cookie",createAuthCookie(context,{secure:shouldUseSecureCookies(req)}));
    return res.status(200).json({authenticated:true,user,organisation:{id:context.organisationId}});
  }
  if(req.method==="GET"){if(req.query?.debug==="1"&&isLocalTestRequest(req)){return res.status(200).json({route:"pages/api/auth",vercelEnv:process.env.VERCEL_ENV||null,nodeEnv:process.env.NODE_ENV||null,hasCookie:Boolean(req.headers?.cookie),hasIdpAuthSecret:Boolean(process.env.IDP_AUTH_SECRET),hasSupabaseUrl:Boolean(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL),hasPublishableKey:Boolean(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY),hasServiceRoleKey:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)});}const context=getAuthContext(req);if(!context)return res.status(200).json({authenticated:false});return res.status(200).json({authenticated:true,requiresPasswordSetup:false,user:{id:context.userId,email:context.email,name:context.name,role:context.role},organisation:{id:context.organisationId}});}
  if(req.method==="POST"){
    const token=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"").trim();
    if(!token)return res.status(401).json({error:"Supabase access token is required."});
    const user=await getSupabaseUser(token);
    if(!user)return res.status(401).json({error:"Supabase session is invalid or expired."});
    const membership=await getMembership(user.id);
    if(!membership)return res.status(403).json({error:"Your Supabase account is not assigned to a Customs IDP organisation."});
    const context={organisationId:membership.organisation_id,userId:user.id,email:user.email||"",name:user.user_metadata?.full_name||user.user_metadata?.name||user.email||"",role:membership.role||"member"};
    res.setHeader("Set-Cookie",createAuthCookie(context,{secure:shouldUseSecureCookies(req)}));
    return res.status(200).json({authenticated:true,user:{id:context.userId,email:context.email,name:context.name,role:context.role},organisation:{id:context.organisationId}});
  }
  if(req.method==="DELETE"){res.setHeader("Set-Cookie",clearAuthCookie());return res.status(200).json({authenticated:false});}
  return res.status(405).json({error:"Method not allowed"});
}

function shouldUseSecureCookies(req){
  if(process.env.NODE_ENV==="production"||process.env.VERCEL_ENV==="production")return true;
  const forwarded=String(req.headers?.["x-forwarded-proto"]||"").split(",")[0].trim().toLowerCase();
  if(forwarded)return forwarded==="https";
  const host=String(req.headers?.host||"").split(":")[0].toLowerCase();
  return host!=="localhost"&&host!=="127.0.0.1"&&host!=="[::1]";
}

function isLocalTestRequest(req){
  if(process.env.NODE_ENV==="production"||process.env.VERCEL_ENV==="production")return false;
  const host=String(req.headers?.host||"").split(":")[0].toLowerCase();
  return host==="localhost"||host==="127.0.0.1"||host==="[::1]";
}

async function getSupabaseUser(accessToken){
  const url=String(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const key=String(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||"sb_publishable_i-IHnlw8Q8BJI-dtBC3WKw_dwVxsE-J");
  if(!url||!key)throw new Error("Supabase URL and publishable key are required for authentication.");
  const response=await fetch(url+"/auth/v1/user",{headers:{apikey:key,Authorization:"Bearer "+accessToken}});
  if(!response.ok)return null;
  return response.json();
}

async function getMembership(userId){
  const url=String(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/$/,"");
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"");
  if(!url||!key)throw new Error("Supabase service configuration is missing.");
  const response=await fetch(url+"/rest/v1/organisation_members?user_id=eq."+encodeURIComponent(userId)+"&select=organisation_id,role&limit=1",{headers:{apikey:key,Authorization:"Bearer "+key}});
  if(!response.ok)throw new Error(await response.text());
  const rows=await response.json();
  return rows[0]||null;
}
