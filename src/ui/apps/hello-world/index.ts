import { AppDefinition } from "../../types";
import { HelloWorldContent } from "./components/hello-world-content";

export const HelloWorldApp: AppDefinition = {
    id: "hello-world",
    icon: "👋",
    label: "Hello World",
    Content: HelloWorldContent,
};
