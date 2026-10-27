import { useRef, useState } from 'react';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { FormError } from './UI';
export function ReportButton({type,id,evidence}:{type:'POST'|'COMMENT'|'RECRUITMENT'|'CHAT_MESSAGE'|'USER';id:string;evidence?:string}) {
  const {user}=useAuth(),[reason,setReason]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const attempt=useRef<object|null>(null);
  if(!user)return null;
  return <details className="report-control"><summary>{type==='USER'?'举报此账号':'举报此内容'}</summary>{done?<p role="status">已提交，将由管理员处理；可在“我的申请与举报”查看结果。</p>:<form className="form-stack" onSubmit={async e=>{e.preventDefault();if(busy||(type==='CHAT_MESSAGE'&&!consent))return;setBusy(true);setError('');attempt.current??={requestKey:crypto.randomUUID(),targetType:type,targetId:id,reason:reason.trim()};try{await api('/reports',{method:'POST',body:attempt.current});attempt.current=null;setDone(true);}catch(e){setError(messageOf(e));if(e instanceof ApiError&&[400,404,409,422,429].includes(e.status))attempt.current=null;}finally{setBusy(false);}}}>{type==='CHAT_MESSAGE'&&<><blockquote>{evidence}</blockquote><label className="checkbox-field"><input type="checkbox" checked={consent} disabled={!!attempt.current} onChange={e=>setConsent(e.target.checked)}/>我确认将这条消息提交给管理员作为举报证据</label></>}<label>举报原因<textarea aria-label="举报原因" value={reason} disabled={busy||!!attempt.current} minLength={5} maxLength={500} rows={2} onChange={e=>setReason(e.target.value)}/></label><FormError>{error}</FormError><button className="button secondary" disabled={busy||reason.trim().length<5||(type==='CHAT_MESSAGE'&&!consent)}>{attempt.current?'核对并重试举报':'提交举报'}</button></form>}</details>;
}
