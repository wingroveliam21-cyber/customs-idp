import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function localApiPlugin(){
  return {
    name:"local-api-adapter",
    configureServer(server){
      server.middlewares.use(async(req,res,next)=>{
        if(!req.url?.startsWith("/api/"))return next();

        const url=new URL(req.url,"http://localhost");
        const handlerPath=url.pathname==="/api/extract"?"./api/extract.js":url.pathname==="/api/packs"?"./api/packs.js":null;
        if(!handlerPath)return next();

        req.query=Object.fromEntries(url.searchParams.entries());
        if(["POST","PUT","PATCH"].includes(req.method||"")){
          let raw="";
          for await(const chunk of req)raw+=chunk;
          try{req.body=raw?JSON.parse(raw):{};}
          catch{return sendJson(res,400,{error:"Request body must be valid JSON"});}
        }

        const response={
          status(code){res.statusCode=code;return response;},
          json(payload){return sendJson(res,res.statusCode||200,payload);}
        };
        try{
          const {default:handler}=await server.ssrLoadModule(handlerPath);
          await handler(req,response);
        }catch(error){
          sendJson(res,500,{error:error.message||"Local API request failed"});
        }
      });
    }
  };
}

function sendJson(res,status,payload){
  if(res.writableEnded)return;
  res.statusCode=status;
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(payload));
}

export default defineConfig(({mode})=>{
  Object.assign(process.env,loadEnv(mode,process.cwd(),""));
  return {plugins:[react(),localApiPlugin()]};
});
