// TODO: implement async map with a concurrency limit.
// mapLimit(items, limit, mapper) returns Promise<result[]> where result[i]
// awaits mapper(items[i], i) — but never runs more than `limit` mappers
// concurrently. Results keep the original order. mapper may reject: the
// whole promise rejects with that error.
export async function mapLimit(items, limit, mapper) {
  if (limit <= 0) {
    throw new Error("limit must be positive");
  }
  
  const results = new Array(items.length);
  const errors = new Array(items.length);
  const pending = new Set();
  let hasError = false;
  let completed = 0;
  
  return new Promise((resolve, reject) => {
    const processItem = async (index) => {
      if (hasError) return;
      
      try {
        const result = await mapper(items[index], index);
        results[index] = result;
      } catch (error) {
        hasError = true;
        errors[index] = error;
        reject(error);
        return;
      } finally {
        pending.delete(index);
        completed++;
        
        // Process next item if available
        if (!hasError) {
          const nextIndex = findNextIndex();
          if (nextIndex !== -1) {
            pending.add(nextIndex);
            processItem(nextIndex);
          }
        }
        
        // Check if all items are completed
        if (completed === items.length) {
          resolve(results);
        }
      }
    };
    
    const findNextIndex = () => {
      for (let i = 0; i < items.length; i++) {
        if (results[i] === undefined && errors[i] === undefined && !pending.has(i)) {
          return i;
        }
      }
      return -1;
    };
    
    // Start up to `limit` items
    for (let i = 0; i < items.length && i < limit; i++) {
      pending.add(i);
      processItem(i);
    }
  });
}
