export const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with ${res.status}`);
  }
  return data;
};
