import type {Metadata} from 'next';
import { BookmarkImport } from '@/components/library/BookmarkImport';
import '@/app/library/library.css';
export const metadata:Metadata={title:'Import bookmarks',robots:{index:false,follow:false}};
export default function ImportPage(){return <BookmarkImport/>;}
