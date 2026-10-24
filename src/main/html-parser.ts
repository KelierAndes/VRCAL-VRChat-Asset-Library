type HtmlLoader=typeof import('cheerio').load;
let parser:HtmlLoader|undefined;

// Keep the complete parser out of startup until an operation actually needs HTML.
export const loadHtml:HtmlLoader=(...args)=>{
 parser??=(require('cheerio') as typeof import('cheerio')).load;
 return parser(...args);
};
