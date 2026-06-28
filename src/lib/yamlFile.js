const fs = require("node:fs/promises");
const yaml = require("yaml");

function parseYaml(contents) {
  return yaml.parse(contents);
}

async function readYamlFile(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  return parseYaml(contents);
}

async function readOptionalYamlFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  return readYamlFile(filePath);
}

module.exports = {
  parseYaml,
  readYamlFile,
  readOptionalYamlFile,
};
