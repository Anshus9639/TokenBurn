export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading this screen…</span>
      <div className="h-2.5 w-40 rounded-sm bg-[#242424]" />
      <div className="mt-3 h-6 w-64 rounded-sm bg-[#202020]" />
      <div className="mt-2 h-3 w-full max-w-[520px] rounded-sm bg-[#151515]" />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] rounded-lg border border-hairline-faint bg-[#0E0E0E] p-4">
            <div className="h-2.5 w-24 rounded-sm bg-[#242424]" />
            <div className="mt-4 h-6 w-32 rounded-sm bg-[#242424]" />
            <div className="mt-3 h-2 w-20 rounded-sm bg-[#181818]" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="h-[300px] rounded-lg border border-hairline-faint bg-[#0E0E0E] lg:col-span-2">
          <div className="h-10 border-b border-hairline-faint" />
          <div className="m-4 h-[220px] rounded-md bg-[#131313]" />
        </div>
        <div className="h-[300px] rounded-lg border border-hairline-faint bg-[#0E0E0E]">
          <div className="h-10 border-b border-hairline-faint" />
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 rounded-sm bg-[#1E1E1E]" style={{ width: `${90 - i * 12}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-hairline-faint bg-[#0E0E0E]">
        <div className="h-10 border-b border-hairline-faint" />
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 rounded-sm bg-[#131313]" />
          ))}
        </div>
      </div>
    </div>
  );
}
