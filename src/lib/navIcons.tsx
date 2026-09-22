import React from "react";
import {
  Home,
  Map,
  MapPin,
  Compass,
  Navigation,
  Navigation2,
  Globe,
  Users,
  Users2,
  User,
  UserCheck,
  Milestone,
  MapPinned,
  Bell,
  BellRing,
  BellDot,
  Settings,
  Settings2,
  Sliders,
  Cog,
  LucideProps
} from "lucide-react";

export type NavIconPackId = "classic" | "minimal" | "rounded" | "bold" | "modern";

export interface NavIconPackDef {
  id: NavIconPackId;
  name: string;
  description: string;
}

export const NAV_ICON_PACKS: NavIconPackDef[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Familiar clean outline icons"
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Very simple thin-line icons"
  },
  {
    id: "rounded",
    name: "Rounded",
    description: "Softer rounded icon shapes that match the frosted UI"
  },
  {
    id: "bold",
    name: "Bold",
    description: "Stronger/thicker icons with a more prominent selected state"
  },
  {
    id: "modern",
    name: "Modern",
    description: "Contemporary/custom-looking icons while remaining clean and easy to recognize"
  }
];

export type NavTabId = "map" | "people" | "places" | "alerts" | "settings";

interface NavIconProps {
  tab: NavTabId;
  pack?: NavIconPackId;
  isSelected?: boolean;
  className?: string;
}

export const NavIcon: React.FC<NavIconProps> = ({
  tab,
  pack = "classic",
  isSelected = false,
  className = "w-4.5 h-4.5"
}) => {
  const commonProps: LucideProps = {
    className
  };

  switch (pack) {
    case "minimal":
      // Ultra-thin line stroke (1.25)
      commonProps.strokeWidth = 1.25;
      if (tab === "map") return <Map {...commonProps} />;
      if (tab === "people") return <User {...commonProps} />;
      if (tab === "places") return <MapPin {...commonProps} />;
      if (tab === "alerts") return <Bell {...commonProps} />;
      if (tab === "settings") return <Sliders {...commonProps} />;
      break;

    case "rounded":
      // Softer curved shapes (1.75 stroke)
      commonProps.strokeWidth = 1.75;
      if (tab === "map") return <Globe {...commonProps} />;
      if (tab === "people") return <Users2 {...commonProps} />;
      if (tab === "places") return <Milestone {...commonProps} />;
      if (tab === "alerts") return <BellDot {...commonProps} />;
      if (tab === "settings") return <Cog {...commonProps} />;
      break;

    case "bold":
      // Stronger thicker icons (2.75 stroke) with prominent filled selected appearance
      commonProps.strokeWidth = 2.75;
      if (isSelected) {
        commonProps.fill = "currentColor";
      }
      if (tab === "map") return <Home {...commonProps} />;
      if (tab === "people") return <Users {...commonProps} />;
      if (tab === "places") return <MapPin {...commonProps} />;
      if (tab === "alerts") return <Bell {...commonProps} />;
      if (tab === "settings") return <Settings {...commonProps} />;
      break;

    case "modern":
      // Geometric / contemporary navigation styling (2.0 stroke)
      commonProps.strokeWidth = 2;
      if (tab === "map") return <Navigation2 {...commonProps} />;
      if (tab === "people") return <UserCheck {...commonProps} />;
      if (tab === "places") return <MapPinned {...commonProps} />;
      if (tab === "alerts") return <BellRing {...commonProps} />;
      if (tab === "settings") return <Settings2 {...commonProps} />;
      break;

    case "classic":
    default:
      // Familiar clean outline icons (2.0 stroke)
      commonProps.strokeWidth = 2;
      if (tab === "map") return <Home {...commonProps} />;
      if (tab === "people") return <Users {...commonProps} />;
      if (tab === "places") return <Compass {...commonProps} />;
      if (tab === "alerts") return <Bell {...commonProps} />;
      if (tab === "settings") return <Settings {...commonProps} />;
      break;
  }

  return <Home {...commonProps} />;
};
