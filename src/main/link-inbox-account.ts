import type {InboxPlatform} from '../shared/link-inbox';
import type {InboxReadResult} from './link-inbox-monitor';

/**
 * Known login routes are sufficient for diagnostics, never proof of a purchase.
 * This URL-only fallback never supplies observations. Actual bounded DOM capture
 * lives in link-inbox-reader/link-inbox-dom and must prove its own account/scope.
 */
export function inboxAccountStatus(platform:InboxPlatform,urls:string[],mode:'foreground'|'background'):InboxReadResult {
 const result=(state:InboxReadResult['state'],message:string):InboxReadResult=>({state,message,observations:[]});
 const parsed=urls.slice(0,20).flatMap(raw=>{try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?[url]:[]}catch{return []}});
 const login=parsed.some(u=>platform==='booth'
  ?u.hostname==='accounts.booth.pm'&&/^\/users\/sign_in(?:\/|$)/.test(u.pathname)||u.hostname==='accounts.pixiv.net'&&/^\/login(?:\/|$)/.test(u.pathname)
  :u.hostname==='login.taobao.com');
 if(login)return result('login','请在官方窗口完成登录；账号页面自动识别仍待验证。');
 if(mode==='background')return result('unsupported','后台会话／购买记录读取尚未完成真实页面验证；暂不自动打开会话。');
 const target=parsed.some(u=>platform==='booth'?u.hostname==='accounts.booth.pm'&&/^\/(?:library|orders)(?:\/|$)/.test(u.pathname):u.hostname==='www.goofish.com'&&u.pathname==='/im');
 return target?result('unsupported','账号页面已打开，交付区域、账号和时间规则尚待验证；没有读取聊天或订单。'):result('paused','请先打开官方消息／已购窗口；当前未读取账号内容。');
}
