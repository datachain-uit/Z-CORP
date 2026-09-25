/**
 * Negative tests for the Merkle-path selector constraint.
 *
 * CredentialVerifier.circom orders each Merkle level with
 *
 *     out[0] <== (in[1] - in[0]) * s + in[0];
 *     out[1] <== (in[0] - in[1]) * s + in[1];
 *
 * These two equations only force  out[0] + out[1] == in[0] + in[1].
 * Because BOTH the selector s and the sibling are prover-supplied witnesses,
 * a prover who does not constrain s to {0,1} can pick
 *
 *     sibling' = A + B - h'
 *     s'       = (A - h') / (A + B - 2h')
 *
 * and force the level-0 Poseidon inputs to an arbitrary pair (A, B),
 * completely detaching the proof from the credential leaf h'.
 * The circuit then proves "knowledge of a Poseidon hash chain ending at root"
 * instead of "knowledge of a credential recorded in the registry".
 *
 * The fix is one constraint inside Selector():   s * (s - 1) === 0;
 *
 * Expected behaviour:
 *   - BEFORE the fix: cases C and D produce accepting proofs -> these tests FAIL.
 *     That failure is the anchor evidence; do not "fix" it by editing this file.
 *   - AFTER the fix:  cases C and D fail during witness generation -> tests PASS.
 *
 * Requires the depth-5 proving artifacts. They are gitignored; generate with:
 *   npm run setup:circuits && npm run merkle:prep-all 5 && npm run setup:input-all
 */
const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const snarkjs = require("snarkjs");
const circomlibjs = require("circomlibjs");

const DEPTH = 5;
const REPO = path.join(__dirname, "..");
const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const mod = (a) => ((a % FIELD) + FIELD) % FIELD;
function inverse(a) {
  // Fermat's little theorem: a^(p-2) mod p
  let result = 1n;
  let base = mod(a);
  let exp = FIELD - 2n;
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base);
    base = mod(base * base);
    exp >>= 1n;
  }
  return result;
}

const circuitDir = path.join(
  REPO, "data", "zkp-circuits", `CredentialVerifier_Depth${DEPTH}`
);
const ARTIFACTS = {
  wasm: path.join(
    circuitDir,
    `CredentialVerifier_Depth${DEPTH}_js`,
    `CredentialVerifier_Depth${DEPTH}.wasm`
  ),
  zkey: path.join(circuitDir, `CredentialVerifier_Depth${DEPTH}_0001.zkey`),
  tree: path.join(REPO, "data", "merkle-trees", `merkle_tree_data_depth_${DEPTH}.json`),
  input: path.join(REPO, "data", "inputs", `input_depth_${DEPTH}_index_0.json`),
};

const artifactsReady = Object.values(ARTIFACTS).every((p) => fs.existsSync(p));
const suite = artifactsReady ? describe : describe.skip;

suite("CredentialVerifier circuit - Merkle selector must be binary", function () {
  this.timeout(120000);

  let vkey, tree, honestInput, honestRoot, poseidon;

  before(async function () {
    vkey = await snarkjs.zKey.exportVerificationKey(ARTIFACTS.zkey);
    tree = JSON.parse(fs.readFileSync(ARTIFACTS.tree, "utf8"));
    honestInput = JSON.parse(fs.readFileSync(ARTIFACTS.input, "utf8"));
    honestRoot = BigInt(tree.root);
    poseidon = await circomlibjs.buildPoseidon();
  });

  /** Returns { witnessFailed, verified, publicRoot }. Never throws. */
  async function attempt(input, tag) {
    const witnessFile = path.join(os.tmpdir(), `zcorp-selector-${tag}.wtns`);
    try {
      await snarkjs.wtns.calculate(input, ARTIFACTS.wasm, witnessFile);
    } catch (err) {
      return { witnessFailed: true, verified: false, publicRoot: null };
    }
    const { proof, publicSignals } = await snarkjs.groth16.prove(
      ARTIFACTS.zkey, witnessFile
    );
    const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    return { witnessFailed: false, verified, publicRoot: BigInt(publicSignals[0]) };
  }

  /** Credential values that are not present in the registry. */
  function forgedWitness(fields) {
    const leafHash = mod(
      BigInt(
        poseidon.F.toString(
          poseidon([
            BigInt(fields.nameHash),
            BigInt(fields.majorCode),
            BigInt(fields.studentId),
            BigInt(fields.issueDate),
          ])
        )
      )
    );

    // The Poseidon input pair the honest path produces at level 0.
    const leaf = mod(BigInt(tree.proofs[0].leaf));
    const sibling = mod(BigInt(honestInput.siblings[0]));
    const [left, right] =
      Number(honestInput.pathIndices[0]) === 0 ? [leaf, sibling] : [sibling, leaf];

    // Solve for the sibling and selector that reproduce (left, right) from leafHash.
    const forgedSibling = mod(left + right - leafHash);
    const forgedSelector = mod(
      mod(left - leafHash) * inverse(mod(left + right - 2n * leafHash))
    );

    return {
      ...fields,
      pathIndices: [
        forgedSelector.toString(),
        ...honestInput.pathIndices.slice(1).map(String),
      ],
      siblings: [
        forgedSibling.toString(),
        ...honestInput.siblings.slice(1).map(String),
      ],
      root: honestInput.root,
    };
  }

  it("[A] accepts a proof for a credential that is in the registry", async function () {
    const { witnessFailed, verified, publicRoot } = await attempt(honestInput, "a");
    expect(witnessFailed, "honest witness generation must succeed").to.equal(false);
    expect(verified, "honest proof must verify").to.equal(true);
    expect(publicRoot).to.equal(honestRoot);
  });

  it("[B] rejects a substituted credential that reuses a genuine path", async function () {
    const { witnessFailed } = await attempt(
      {
        nameHash: "1",
        majorCode: 999,
        studentId: "99999999",
        issueDate: "19000101",
        pathIndices: honestInput.pathIndices,
        siblings: honestInput.siblings,
        root: honestInput.root,
      },
      "b"
    );
    expect(
      witnessFailed,
      "the root equality constraint must reject a substituted credential"
    ).to.equal(true);
  });

  it("[C] rejects a forged selector outside {0,1}", async function () {
    const { witnessFailed, verified } = await attempt(
      forgedWitness({
        nameHash: "1",
        majorCode: 999,
        studentId: "99999999",
        issueDate: "19000101",
      }),
      "c"
    );
    expect(
      verified,
      "SELECTOR IS UNCONSTRAINED: a proof for a credential outside the registry " +
        "verified against the authorised root. Add s * (s - 1) === 0 to Selector()."
    ).to.equal(false);
    expect(witnessFailed, "the binary constraint must reject a non-binary selector")
      .to.equal(true);
  });

  it("[D] rejects a forged selector when no credential is known at all", async function () {
    const { witnessFailed, verified } = await attempt(
      forgedWitness({
        nameHash: "0", majorCode: "0", studentId: "0", issueDate: "0",
      }),
      "d"
    );
    expect(
      verified,
      "SELECTOR IS UNCONSTRAINED: knowledge of a leaf hash and its siblings alone " +
        "produced an accepting proof, with no credential preimage."
    ).to.equal(false);
    expect(witnessFailed).to.equal(true);
  });
});

if (!artifactsReady) {
  const missing = Object.entries(ARTIFACTS)
    .filter(([, p]) => !fs.existsSync(p))
    .map(([k]) => k);
  console.warn(
    `[selector negative tests] skipped - missing depth-${DEPTH} artifacts: ${missing.join(", ")}\n` +
      "  generate with: npm run setup:circuits && npm run merkle:prep-all " +
      `${DEPTH} && npm run setup:input-all`
  );
}
