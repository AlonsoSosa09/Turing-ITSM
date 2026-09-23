import { TuringItsmLanding } from "@/components/marketing/TuringItsmLanding";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TuringITSM | Gestión moderna de servicios de TI",
  description:
    "Centralizá proyectos, actualizaciones de equipo y visibilidad operativa en una plataforma de trabajo para equipos de TI.",
  openGraph: {
    title: "TuringITSM | Gestión moderna de servicios de TI",
    description:
      "Proyectos, actualizaciones de equipo y visibilidad operativa para equipos de TI.",
    type: "website",
  },
};

export default function HomePage() {
  return <TuringItsmLanding />;
}
