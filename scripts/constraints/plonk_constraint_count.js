const { readR1cs } = require('r1csfile');
const { getCurveFromName } = require('ffjavascript');

function log2(value) {
    if (value <= 0) {
        return 0;
    }
    return Math.floor(Math.log2(value));
}

/**
 * Count PLONK gates after snarkjs converts an R1CS file.
 * Logic mirrors snarkjs/src/plonk_setup.js::processConstraints.
 */
async function countPlonkConstraints(r1csPath) {
    const r1cs = await readR1cs(r1csPath, true, false);
    const curve = await getCurveFromName('bn128');
    const Fr = curve.Fr;
    const nPublic = r1cs.nOutputs + r1cs.nPubInputs;

    const plonkConstraints = [];
    const plonkAdditions = [];
    let plonkNVars = r1cs.nVars;

    function normalize(linearComb) {
        const keys = Object.keys(linearComb);
        for (let i = 0; i < keys.length; i++) {
            if (linearComb[keys[i]] === 0n) {
                delete linearComb[keys[i]];
            }
        }
    }

    function join(linearComb1, k, linearComb2) {
        const res = {};

        for (const s in linearComb1) {
            if (typeof res[s] === 'undefined') {
                res[s] = Fr.mul(k, linearComb1[s]);
            } else {
                res[s] = Fr.add(res[s], Fr.mul(k, linearComb1[s]));
            }
        }

        for (const s in linearComb2) {
            if (typeof res[s] === 'undefined') {
                res[s] = linearComb2[s];
            } else {
                res[s] = Fr.add(res[s], linearComb2[s]);
            }
        }

        normalize(res);
        return res;
    }

    function reduceCoefs(linearComb, maxC) {
        const res = {
            k: Fr.zero,
            s: [],
            coefs: [],
        };
        const cs = [];

        for (const s in linearComb) {
            if (s === '0') {
                res.k = Fr.add(res.k, linearComb[s]);
            } else if (linearComb[s] !== 0n) {
                cs.push([Number(s), linearComb[s]]);
            }
        }

        while (cs.length > maxC) {
            const c1 = cs.shift();
            const c2 = cs.shift();

            const sl = c1[0];
            const sr = c2[0];
            const so = plonkNVars++;
            const qm = Fr.zero;
            const ql = Fr.neg(c1[1]);
            const qr = Fr.neg(c2[1]);
            const qo = Fr.one;
            const qc = Fr.zero;

            plonkConstraints.push([sl, sr, so, qm, ql, qr, qo, qc]);
            plonkAdditions.push([sl, sr, c1[1], c2[1]]);
            cs.push([so, Fr.one]);
        }

        for (let i = 0; i < cs.length; i++) {
            res.s[i] = cs[i][0];
            res.coefs[i] = cs[i][1];
        }

        while (res.coefs.length < maxC) {
            res.s.push(0);
            res.coefs.push(Fr.zero);
        }

        return res;
    }

    function addConstraintSum(lc) {
        const C = reduceCoefs(lc, 3);
        plonkConstraints.push([
            C.s[0],
            C.s[1],
            C.s[2],
            Fr.zero,
            C.coefs[0],
            C.coefs[1],
            C.coefs[2],
            C.k,
        ]);
    }

    function addConstraintMul(lcA, lcB, lcC) {
        const A = reduceCoefs(lcA, 1);
        const B = reduceCoefs(lcB, 1);
        const C = reduceCoefs(lcC, 1);

        plonkConstraints.push([
            A.s[0],
            B.s[0],
            C.s[0],
            Fr.mul(A.coefs[0], B.coefs[0]),
            Fr.mul(A.coefs[0], B.k),
            Fr.mul(A.k, B.coefs[0]),
            Fr.neg(C.coefs[0]),
            Fr.sub(Fr.mul(A.k, B.k), C.k),
        ]);
    }

    function getLinearCombinationType(lc) {
        let k = Fr.zero;
        let n = 0;
        const keys = Object.keys(lc);

        for (let i = 0; i < keys.length; i++) {
            if (lc[keys[i]] === 0n) {
                delete lc[keys[i]];
            } else if (keys[i] === '0') {
                k = Fr.add(k, lc[keys[i]]);
            } else {
                n++;
            }
        }

        if (n > 0) {
            return n.toString();
        }
        if (k !== Fr.zero) {
            return 'k';
        }
        return '0';
    }

    function process(lcA, lcB, lcC) {
        const lctA = getLinearCombinationType(lcA);
        const lctB = getLinearCombinationType(lcB);

        if (lctA === '0' || lctB === '0') {
            normalize(lcC);
            addConstraintSum(lcC);
        } else if (lctA === 'k') {
            const lcCC = join(lcB, lcA[0], lcC);
            addConstraintSum(lcCC);
        } else if (lctB === 'k') {
            const lcCC = join(lcA, lcB[0], lcC);
            addConstraintSum(lcCC);
        } else {
            addConstraintMul(lcA, lcB, lcC);
        }
    }

    for (let s = 1; s <= nPublic; s++) {
        plonkConstraints.push([s, 0, 0, Fr.zero, Fr.one, Fr.zero, Fr.zero, Fr.zero]);
    }

    for (let c = 0; c < r1cs.constraints.length; c++) {
        process(...r1cs.constraints[c]);
    }

    let cirPower = log2(plonkConstraints.length - 1) + 1;
    if (cirPower < 3) {
        cirPower = 3;
    }

    await curve.terminate();

    return {
        plonkConstraints: plonkConstraints.length,
        plonkAdditions: plonkAdditions.length,
        plonkDomainSize: 2 ** cirPower,
        plonkWires: plonkNVars,
    };
}

function groth16DomainSize(r1cs) {
    const total = r1cs.nConstraints + r1cs.nPubInputs + r1cs.nOutputs + 1;
    const power = total <= 1 ? 1 : Math.floor(Math.log2(total - 1)) + 1;
    return 2 ** power;
}

module.exports = {
    countPlonkConstraints,
    groth16DomainSize,
};
