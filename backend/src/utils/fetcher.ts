export const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with ${res.status}`);
  }
  if (data === null) {
    throw new Error("Response is not valid JSON");
  }
  return data;
};
