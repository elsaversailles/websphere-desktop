import { useEffect, useState } from 'react';

export type ListPage<T> = { items: T[]; page: number; totalPages: number; total: number };
type Option = { value: string; label: string };

export function useListFilters(sort = 'recent', statusParam = 'status') {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => { setTerm(search.trim()); setPage(1); }, 260);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = new URLSearchParams({ page: String(page), sort, ...(term ? { q: term } : {}), ...(status ? { [statusParam]: status } : {}) }).toString();
  return {
    page, setPage, search, setSearch, status, query,
    setStatus(value: string) { setStatus(value); setPage(1); },
    reset() { setSearch(''); setTerm(''); setStatus(''); setPage(1); },
  };
}

export function ListFilters({ filters, statuses, placeholder }: { filters: ReturnType<typeof useListFilters>; statuses: Option[]; placeholder: string }) {
  return <div className="user-search list-filters">
    <input type="search" className="ifield" value={filters.search} placeholder={placeholder} aria-label={placeholder} onChange={(event) => filters.setSearch(event.target.value)} />
    <select className="legacy-select" value={filters.status} aria-label="Filter by status" onChange={(event) => filters.setStatus(event.target.value)}>
      <option value="">All statuses</option>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
    </select>
    <button className="btn-o btn-sm" type="button" onClick={filters.reset}>Reset filters</button>
  </div>;
}

export function ListPager({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (index: number) => void }) {
  if (totalPages <= 1) return null;
  return <div className="user-pager">
    <button className="btn-o btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
    <span>Page {page} of {totalPages}</span>
    <button className="btn-o btn-sm" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
  </div>;
}
