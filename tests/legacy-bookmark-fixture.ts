import type { PoolClient } from 'pg';
/** Fixture an installation's then-existing intake function before the current application/migrations exist. */
export async function legacyBookmark(connection:PoolClient,owner:string,post:{postId:string;url:string;text:string;author:{name:string;handle:string};observedAt:string;links?:string[]}) {
 const id='legacy-post-'+post.postId;
 const doc={id,title:post.text,source:'X',sourceUrl:post.url,origin:'paste',contentType:'post',blocks:[{id:'b1',type:'p',runs:[{text:post.text}]}],post:{postId:post.postId,url:post.url,fullText:post.text,author:post.author,observedAt:post.observedAt,links:post.links??[],completeness:{status:'unknown',verification:'agent_reported'},provenance:{via:'Historical upgrade fixture',receivedAt:post.observedAt}}};
 const data={id,title:doc.title,source:'X',sourceUrl:post.url,origin:'paste',contentType:'post',words:post.text.split(/\s+/).length,processing:{classification:'pending',indexing:'pending'}};
 const rows=await connection.query('select intake_bookmark($1,$2,$3,$4::jsonb,$5::jsonb,$6) receipt',[owner,post.postId,post.url,JSON.stringify(data),JSON.stringify(doc),'bookmark']);
 return {results:[rows.rows[0].receipt]};
}
