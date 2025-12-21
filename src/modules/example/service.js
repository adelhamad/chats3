// Example service
import { EXAMPLE_MESSAGE } from "./constants/index.js";

export function getExampleData() {
  return {
    message: EXAMPLE_MESSAGE,
    version: "1.0.0",
    status: "active",
  };
}

export function getExampleById(id) {
  return {
    id,
    name: `Example ${id}`,
    description: "This is a dummy example item",
  };
}
