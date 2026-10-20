const isMissing=value=>value===undefined||value===null||value==="";

const readPath=(object,path)=>String(path||"").split(".").filter(Boolean).reduce((value,key)=>value==null?undefined:value[key],object);
const writePath=(object,path,value)=>{
  const parts=String(path||"").split(".").filter(Boolean);
  if(!parts.length)return false;
  let target=object;
  for(const key of parts.slice(0,-1)){if(!target[key]||typeof target[key]!=="object"||Array.isArray(target[key]))target[key]={};target=target[key];}
  target[parts.at(-1)]=value;return true;
};
const outcome=(category,status,summary,extra={})=>({category,status,summary,...extra});

export function applyCustomerStrategyRules(inputRecord,strategy={}){
  const record=structuredClone(inputRecord||{}),applications=[],changes=[],exceptions=[];
  for(const category of ["extractionRules","fieldRules"]){
    for(const [index,rule] of (Array.isArray(strategy[category])?strategy[category]:[]).entries()){
      if(!rule||typeof rule!=="object"||Array.isArray(rule)){applications.push(outcome(category,"unsupported","Rule is narrative text, not an executable structured rule.",{index,configuredRule:rule}));continue;}
      const type=String(rule.type||rule.action||"").toLowerCase(),field=rule.field||rule.targetField||rule.target;
      if(type==="set_field"&&field&&!isMissing(rule.value)){
        const before=readPath(record,field);writePath(record,field,rule.value);
        if(JSON.stringify(before)!==JSON.stringify(rule.value))changes.push({category,type,field,before:before??null,after:rule.value,reason:rule.reason||"Configured customer rule"});
        applications.push(outcome(category,"applied","Configured field value rule executed.",{index,field,before:before??null,after:rule.value}));
      }else if(type==="copy_if_missing"&&field&&(rule.sourceField||rule.from)){
        const sourceField=rule.sourceField||rule.from,before=readPath(record,field),source=readPath(record,sourceField);
        if(isMissing(before)&&!isMissing(source)){writePath(record,field,source);changes.push({category,type,field,before:null,after:source,sourceField,reason:rule.reason||"Copy missing field"});applications.push(outcome(category,"applied","Copied a source value into a missing field.",{index,field,sourceField}));}
        else applications.push(outcome(category,"no_change_needed","Target already has a value or source is missing.",{index,field,sourceField}));
      }else if(type==="map_value"&&field&&rule.mapping&&typeof rule.mapping==="object"){
        const before=readPath(record,field);
        if(Object.hasOwn(rule.mapping,String(before))){const after=rule.mapping[String(before)];writePath(record,field,after);changes.push({category,type,field,before:before??null,after,reason:rule.reason||"Configured mapping"});applications.push(outcome(category,"applied","Mapped field using configured mapping.",{index,field,before:before??null,after}));}
        else applications.push(outcome(category,"not_applied","Current value did not match a mapping key.",{index,field,before:before??null}));
      }else if(type==="require_field"&&field){
        if(isMissing(readPath(record,field))){exceptions.push({category,field,message:rule.message||"Required field is missing: "+field,severity:rule.severity||"review"});applications.push(outcome(category,"exception","Required field is missing.",{index,field}));}
        else applications.push(outcome(category,"passed","Required field is present.",{index,field}));
      }else applications.push(outcome(category,"unsupported","Rule type is not supported by the deterministic executor.",{index,configuredType:type||null,configuredRule:rule}));
    }
  }
  for(const field of Array.isArray(strategy.requiredFields)?strategy.requiredFields:[]){
    if(typeof field!=="string"||!field.trim())continue;
    if(isMissing(readPath(record,field))){exceptions.push({category:"requiredFields",field,message:"Required customer field is missing: "+field,severity:"review"});applications.push(outcome("requiredFields","exception","Required customer field is missing.",{field}));}
    else applications.push(outcome("requiredFields","passed","Required customer field is present.",{field}));
  }
  for(const category of ["validationRules","customValidations"]){
    for(const [index,rule] of (Array.isArray(strategy[category])?strategy[category]:[]).entries()){
      if(!rule||typeof rule!=="object"||Array.isArray(rule)){applications.push(outcome(category,"unsupported","Validation rule is not a structured rule object.",{index,configuredRule:rule}));continue;}
      const type=String(rule.type||rule.ruleType||"").toLowerCase(),field=rule.field||rule.targetField,actual=readPath(record,field);
      if(["required","required_field"].includes(type)){
        if(!field||isMissing(actual)){exceptions.push({category,field:field||null,message:rule.message||"Required field is missing: "+(field||"unspecified"),severity:rule.severity||"review"});applications.push(outcome(category,"exception","Required-field validation failed.",{index,field:field||null}));}
        else applications.push(outcome(category,"passed","Required-field validation passed.",{index,field}));
      }else if(["equals","equals_value"].includes(type)){
        const expected=rule.expected??rule.value;
        if(!field||String(actual??"")!==String(expected??"")){exceptions.push({category,field:field||null,message:rule.message||"Configured equality check failed for "+(field||"unspecified"),severity:rule.severity||"review",actual:actual??null,expected:expected??null});applications.push(outcome(category,"exception","Equality validation failed.",{index,field:field||null,actual:actual??null,expected:expected??null}));}
        else applications.push(outcome(category,"passed","Equality validation passed.",{index,field}));
      }else applications.push(outcome(category,"unsupported","Validation type is not supported by the deterministic executor.",{index,configuredType:type||null,configuredRule:rule}));
    }
  }
  record.customerStrategyApplications=[...(record.customerStrategyApplications||[]),...applications];
  record.customerStrategyChanges=[...(record.customerStrategyChanges||[]),...changes];
  record.customerStrategyExceptions=[...(record.customerStrategyExceptions||[]),...exceptions];
  return {record,applications,changes,exceptions};
}

export function summariseCustomerStrategyExecution(execution){
  const applications=execution?.applications||[],changes=execution?.changes||[],exceptions=execution?.exceptions||[];
  return {evaluated:applications.length,applied:applications.filter(x=>x.status==="applied").length,passed:applications.filter(x=>x.status==="passed").length,unchanged:applications.filter(x=>x.status==="no_change_needed").length,skipped:applications.filter(x=>x.status==="not_applied").length,unsupported:applications.filter(x=>x.status==="unsupported").length,changes,exceptions,applications};
}
