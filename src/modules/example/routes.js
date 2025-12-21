// Example routes - Dummy API to test Fastify
import { getExampleData, getExampleById } from "./service.js";
import { success } from "../../constants/response.js";

export default async function exampleRoutes(fastify) {
  // Get example data
  fastify.get("/example", async () => {
    const data = getExampleData();
    return success.parse({ message: "Example data retrieved", details: data });
  });

  // Get example by ID
  fastify.get("/example/:id", async (request) => {
    const { id } = request.params;
    const data = getExampleById(id);
    return success.parse({ message: "Example retrieved", details: data });
  });
}
