export function debounce(fn, delay = 200, { now = Date.now } = {}) {
  let timeoutId = null;
  let pendingArgs = null;
  let scheduledTime = null;

  const debounced = (...args) => {
    pendingArgs = args;
    
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    
    const currentTime = now();
    scheduledTime = currentTime + delay;
    
    timeoutId = setTimeout(() => {
      fn(...pendingArgs);
      pendingArgs = null;
      scheduledTime = null;
    }, delay);
  };

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      pendingArgs = null;
      scheduledTime = null;
    }
  };

  return debounced;
}
