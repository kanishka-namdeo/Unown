export function debounce(fn, delay = 200, { now = Date.now } = {}) {
  let timeoutId = null;
  let lastArgs = null;
  let lastTime = 0;

  const debounced = (...args) => {
    lastArgs = args;
    lastTime = now();
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...lastArgs);
      timeoutId = null;
      lastArgs = null;
    }, delay);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return debounced;
}
