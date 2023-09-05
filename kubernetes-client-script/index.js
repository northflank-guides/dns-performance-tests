import k8s from "@kubernetes/client-node";
import _ from "lodash";
import { customAlphabet } from "nanoid";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

// Only lowercase alphanumeric
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet);

// Input files
const externalDomainsFile = 'external-domains.txt';
const internalSvcDomainsFile = "internal-svc-generated-domains.txt";
const internalUndefinedSvcDomainsFile = "internal-svc-undefined-domains.txt";

const main = async () => {
  try {
    const numberOfServices = 500;
    const namespaceName = "coredns-services";
    const ns = await k8sApi
      .createNamespace({
        metadata: { name: namespaceName },
      })
      .catch((e) => {
        if (e.statusCode === 409) {
          console.log("Namespace already exists");
          return e;
        }
        throw new e();
      });

    const internalDomainContents = await generateAndCreateServices(namespaceName, numberOfServices);

    const internalUndefinedDomainContents = await generateUndefinedServices(numberOfServices);

    await mergeDomainFiles(
      internalDomainContents,
      internalUndefinedDomainContents
    );
  } catch (err) {
    console.error(err);
  }
};

const generateAndCreateServices = async (namespaceName, numberOfServices) => {
  const svcsCreated = await k8sApi.listNamespacedService(namespaceName);
  let serviceNames = [];

  if (svcsCreated.body.items.length > 0) {
    console.log(
      `There are already ${svcsCreated.body.items.length} svcs created`
    );
    serviceNames = svcsCreated.body.items.map((svc) => svc.metadata.name);
  } else {
    serviceNames = generateRandomServiceNames(numberOfServices);

    await Promise.all(
      serviceNames.map((svcName) =>
        k8sApi.createNamespacedService(namespaceName, {
          metadata: { name: svcName },
          spec: { ports: [{ port: 8080, protocol: "TCP" }] },
        })
      )
    );
  }

  const fileContents = serviceNames.reduce(
    (domains, d) => `${domains}${d}.${namespaceName}.svc.cluster.local A\n`,
    ""
  )
  await fs.writeFile(
    path.join(__dirname, internalSvcDomainsFile),
    fileContents
  );

  return fileContents;
};

const generateUndefinedServices = async (numberOfServices) => {
  const undefinedServiceNames = generateRandomServiceNames(numberOfServices);
  const fileContents = undefinedServiceNames.reduce(
    (domains, d) => `${domains}${d}.undefined-namespace.svc.cluster.local A\n`,
    ""
  )
  await fs.writeFile(
    path.join(__dirname, internalUndefinedSvcDomainsFile),
    fileContents
  );
  return fileContents;
};

const mergeDomainFiles = async (internalDomainContents, internalUndefinedDomainContents) => {
  const externalDomainContents = await fs.readFile(
    path.join(__dirname, externalDomainsFile)
  );

  await fs.writeFile(
    path.join(__dirname, "generated-file.txt"),
    `${externalDomainContents}${internalDomainContents}${internalUndefinedDomainContents}`
  );
}

const generateRandomServiceNames = (svcCount) => {
  return _.times(svcCount, () => `coredns-svc-${nanoid()}`);
};

main();
