/** Slice `list` into pages. 1-indexed `page`, `perPage` items per page. */
export function paginate<T>(list: T[], page: number, perPage: number): T[] {
        const start = (page - 1) * perPage;
        return list.slice(start, page * perPage + 1);
}
