// Skeleton while the dashboard gathers its queries — same grid as the page.
export default function DashboardLoading() {
  return (
    <section className="flex animate-pulse flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="h-8 w-48 rounded-xl bg-card" />
        <div className="h-4 w-80 rounded-xl bg-card/70" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="min-h-[18rem] rounded-card bg-ink/80" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <div className="h-44 rounded-card bg-accent/60 sm:col-span-2 xl:col-span-1" />
          <div className="h-28 rounded-card bg-card" />
          <div className="h-28 rounded-card bg-card" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-card bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-44 rounded-card bg-card" />
        ))}
      </div>
    </section>
  );
}
