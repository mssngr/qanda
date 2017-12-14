/**
* @param context {WebtaskContext}
*/
module.exports = function(context, cb) {
	console.log(context)
	cb(null, 'received')
}
