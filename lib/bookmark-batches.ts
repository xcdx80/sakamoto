/** Match the existing intake contract for every bookmark source, before advancing its checkpoint. */
export function bookmarkBatch<T>(posts:T[],offset:number):T[]{
 const batch:T[]=[];
 let bytes=500; // Delivery envelope overhead.
 for(const post of posts.slice(offset,offset+25)){
  const size=new TextEncoder().encode(JSON.stringify(post)).length;
  if(bytes+size>1_900_000)break;
  batch.push(post);bytes+=size;
 }
 if(offset<posts.length&&!batch.length)throw new Error('A post and its context exceed the import limit. Import this post separately.');
 return batch;
}
