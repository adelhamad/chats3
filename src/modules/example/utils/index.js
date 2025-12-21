// Example module utilities
export function formatResponse(data) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}
