import type {Metadata} from 'next';
import { BookmarkImport } from '@/components/library/BookmarkImport';
export const metadata:Metadata={title:'Import bookmarks',robots:{index:false,follow:false}};
export default function ImportPage(){return <BookmarkImport/>;}
