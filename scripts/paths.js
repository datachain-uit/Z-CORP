const path = require('path');

// Gốc project (thư mục chứa package.json)
const projectRoot = path.join(__dirname, '..');

// Thư mục dữ liệu (gọn toàn bộ file data tại đây)
const dataDir = path.join(projectRoot, 'data');

// Các file dữ liệu chính (trong data/)
const DIPLOMA_SAMPLES_FILE = path.join(dataDir, 'diploma_samples.json');
const PROCESSED_DIPLOMAS_FILE = path.join(dataDir, 'processed_diplomas.json');
const MERKLE_TREE_FILE = path.join(dataDir, 'merkle_tree_data.json');
const INPUT_FILE = path.join(dataDir, 'input.json');

// File Merkle tree theo depth
function merkleTreeDepthFile(depth) {
  return path.join(dataDir, `merkle_tree_data_depth_${depth}.json`);
}

// File input theo depth + index
function inputDepthFile(depth, index) {
  return path.join(dataDir, `input_depth_${depth}_index_${index}.json`);
}

module.exports = {
  projectRoot,
  dataDir,
  DIPLOMA_SAMPLES_FILE,
  PROCESSED_DIPLOMAS_FILE,
  MERKLE_TREE_FILE,
  INPUT_FILE,
  merkleTreeDepthFile,
  inputDepthFile,
};
