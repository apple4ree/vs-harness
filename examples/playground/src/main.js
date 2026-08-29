import { createGreeting } from "./services/greeting.js";
import { renderGreeting } from "./ui/presenter.js";

console.log(renderGreeting(createGreeting("Witch")));
