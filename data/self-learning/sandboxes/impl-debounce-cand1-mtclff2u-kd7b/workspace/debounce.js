export function debounce(fn, delay = 200, { now = Date.now } = {}) {
  let pendingArgs = null;
  let scheduledTime = null;
  
  const debounced = (...args) => {
    // Check if there's a pending call that should fire now
    if (pendingArgs !== null && now() >= scheduledTime) {
      fn(...pendingArgs);
      pendingArgs = null;
      scheduledTime = null;
    }
    
    // Store the latest arguments
    pendingArgs = args;
    
    // Calculate when this call should fire
    scheduledTime = now() + delay;
  };
  
  debounced.cancel = () => {
    pendingArgs = null;
    scheduledTime = null;
  };
  
  return debounced;
}
