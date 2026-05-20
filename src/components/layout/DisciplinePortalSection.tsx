import PortalDisciplineCard from "@/components/layout/PortalDisciplineCard";
import { fetchDisciplinePortal } from "@/lib/liquipedia/portal";

type Props = {
  slug: string;
  icon: string;
  bg: string;
};

export default async function DisciplinePortalSection({ slug, icon, bg }: Props) {
  const data = await fetchDisciplinePortal(slug);
  
  return (
    <PortalDisciplineCard
      slug={data.slug}
      name={data.name}
      iconUrl={icon}
      bgUrl={bg}
      tournaments={data.tournaments}
    />
  );
}
