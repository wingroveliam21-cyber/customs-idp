import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import {
  passwordRecoveryCallbackError,
  shouldKeepPasswordSetup,
  shouldWaitForPasswordRecovery
} from "../auth/passwordRecovery.js";

const RECOVERY_SESSION_WAIT_MS=5000;

export function useAuthSession({ localTestRoute }) {
  const [authenticated,setAuthenticated]=useState(null);
  const [currentUser,setCurrentUser]=useState(null);
  const [passwordSetup,setPasswordSetup]=useState(false);
  const [authError,setAuthError]=useState("");
  const passwordSetupActive=useRef(false);
  const recoveryTimer=useRef(null);
  const setPasswordSetupMode=useCallback(active=>{
    passwordSetupActive.current=Boolean(active);
    setPasswordSetup(Boolean(active));
  },[]);

  useEffect(()=>{
    let active=true;
    if(localTestRoute){setAuthenticated(false);return()=>{active=false;};}

    const clearRecoveryTimer=()=>{
      if(recoveryTimer.current){clearTimeout(recoveryTimer.current);recoveryTimer.current=null;}
    };
    const finishFailedRecovery=message=>{
      clearRecoveryTimer();
      if(active){
        setAuthError(message||"This password recovery link is invalid or has expired. Request a new password reset email.");
        setCurrentUser(null);setAuthenticated(false);setPasswordSetupMode(false);
      }
    };

    const syncSession=async(session,event="")=>{
      const locationLike=typeof window!=="undefined"?window.location:undefined;
      if(!session?.access_token){
        const callbackError=passwordRecoveryCallbackError(locationLike);
        if(callbackError){finishFailedRecovery(callbackError);return;}
        if(passwordSetupActive.current||shouldWaitForPasswordRecovery({session,locationLike})){
          if(active)setAuthenticated(current=>current===false?null:current);
          if(!recoveryTimer.current){
            recoveryTimer.current=setTimeout(()=>finishFailedRecovery(),RECOVERY_SESSION_WAIT_MS);
          }
          return;
        }
        clearRecoveryTimer();
        try{await fetch("/api/auth",{method:"DELETE",credentials:"include"});}catch{}
        if(active){setAuthError("");setCurrentUser(null);setAuthenticated(false);setPasswordSetupMode(false);}
        return;
      }

      clearRecoveryTimer();
      if(active)setAuthError("");

      const needsSetup=shouldKeepPasswordSetup({
        active:passwordSetupActive.current,
        event,
        session,
        locationLike
      });
      if(needsSetup){
        if(active){setCurrentUser(null);setAuthenticated(false);setPasswordSetupMode(true);}
        return;
      }

      try{
        supabase.realtime.setAuth(session.access_token);
        const response=await fetch("/api/auth",{method:"POST",headers:{Authorization:"Bearer "+session.access_token},credentials:"include"});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||"Authentication failed.");
        if(active){
          setPasswordSetupMode(false);
          setCurrentUser(data.user?{...data.user,organisationId:data.organisation?.id||data.user.organisationId||null}:null);
          setAuthenticated(true);
        }
      }catch(error){
        await supabase.auth.signOut().catch(()=>{});
        if(active){setCurrentUser(null);setAuthenticated(false);setPasswordSetupMode(false);}
      }
    };

    supabase.auth.getSession().then(({data:{session}})=>{
      if(active)syncSession(session,"INITIAL_SESSION");
    });

    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==="SIGNED_OUT"){
        if(active){setCurrentUser(null);setAuthenticated(false);setPasswordSetupMode(false);}
      } else if(session){
        syncSession(session,event);
      }
    });

    return()=>{active=false;clearRecoveryTimer();subscription.unsubscribe();};
  },[localTestRoute,setPasswordSetupMode]);

  return { authenticated, currentUser, passwordSetup, authError, setAuthenticated, setCurrentUser, setPasswordSetup:setPasswordSetupMode };
}
