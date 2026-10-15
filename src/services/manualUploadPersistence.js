export async function persistManualUploadSources({
  initialPack,
  sourceFiles,
  persistPack,
  createUploadTarget,
  uploadSource
}) {
  let persistedPack=await persistPack(initialPack);
  if(!persistedPack){
    const error=new Error("Could not create the document pack before upload");
    error.stage="create";
    throw error;
  }

  let uploadedFiles=initialPack.uploadedFiles;
  const uploadResults=await Promise.allSettled(sourceFiles.map(async(file,index)=>{
    const metadata=uploadedFiles[index];
    const target=await createUploadTarget(metadata,persistedPack);
    await uploadSource(file,metadata,target);
    return {...metadata,storagePath:target.path};
  }));
  uploadedFiles=uploadResults.map((result,index)=>result.status==="fulfilled"?result.value:uploadedFiles[index]);
  const failedUpload=uploadResults.find(result=>result.status==="rejected");
  if(failedUpload){
    const error=failedUpload.reason instanceof Error?failedUpload.reason:new Error(String(failedUpload.reason||"Unknown storage error"));
    error.stage="upload";
    error.persistedPack=persistedPack;
    error.uploadedFiles=uploadedFiles;
    throw error;
  }

  const savedPack=await persistPack({...persistedPack,uploadedFiles});
  if(!savedPack){
    const error=new Error("Could not persist source document metadata");
    error.stage="metadata";
    error.persistedPack=persistedPack;
    error.uploadedFiles=uploadedFiles;
    throw error;
  }
  return savedPack;
}
